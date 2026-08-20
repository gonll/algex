// Fixed and entropy-adaptive chunk strategies.
// Adaptive splits where Shannon entropy shifts significantly — the LFSR on each side
// of a boundary is shorter than one spanning the whole mixed region.
//
// Second pass: model-aware split (roadmap 2, Priority 1). After entropy-based
// chunking, any chunk whose overall linear complexity is too high for one model
// gets a bounded boundary search: scan for the point where the LOCAL LFSR model
// actually changes (not just where entropy shifts — two adjacent LFSRs can share
// ~8 bits/byte entropy while using completely different generators), then verify
// the best few candidates by comparing actual encoded cost of splitting vs not.
// Only commits to a split when it's a real, measured win — see modelAwareSplit.

import { shannonEntropy } from "../core/entropy"
import { addon } from "../native/addon"
import { SearchBudget, DEFAULT_BUDGET } from "./search-budget"

const FIXED_CHUNK_SIZE = 512
const WINDOW = 64          // entropy sample window
const DELTA_THRESHOLD = 1.5  // bits/byte change to trigger a split
const MIN_CHUNK = 128
const MAX_CHUNK = 4096

export const fixedChunks = (
  buf: Uint8Array,
  size = FIXED_CHUNK_SIZE
): Uint8Array[] => {
  const out: Uint8Array[] = []
  for (let i = 0; i < buf.length; i += size)
    out.push(buf.slice(i, Math.min(i + size, buf.length)))
  return out
}

// Compute the entropy contrast (|after − before|) at a candidate split point.
const splitContrast = (buf: Uint8Array, pos: number): number => {
  const lo = Math.max(0, pos - WINDOW)
  const hi = Math.min(buf.length, pos + WINDOW)
  if (pos - lo < 8 || hi - pos < 8) return 0
  const before = shannonEntropy(buf.slice(lo, pos))
  const after  = shannonEntropy(buf.slice(pos, hi))
  return Math.abs(after - before)
}

// After detecting a split, try ±REFINE offsets and keep whichever maximises the
// entropy contrast — aligns the boundary with the sharpest statistical transition.
const REFINE = 4

const refineBoundary = (buf: Uint8Array, b: number, prev: number, next: number): number => {
  let best = b
  let bestScore = splitContrast(buf, b)
  for (let d = -REFINE; d <= REFINE; d++) {
    const c = b + d
    if (c <= prev + MIN_CHUNK || c >= next - MIN_CHUNK) continue
    const score = splitContrast(buf, c)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return best
}

// Max LFSR order we test during model-stability check.  BM with this cap aborts
// in O(N × L_CAP) time — fast even for large chunks.
const MS_L_CAP = 5

// Window size for a single local complexity sample, using a short window to
// keep BM O(MS_L_CAP²). 2*L_CAP+10 bytes is sufficient to confirm L ≤ L_CAP.
const LC_WINDOW = 2 * MS_L_CAP + 10

// ── Model-aware boundary search ───────────────────────────────────────────────
//
// Cheap proxy for "how many bytes would encoding this buffer cost", used only
// to rank/gate candidate boundaries — callers that care about the real answer
// (the encoder) inject their own estimator built on the actual candidate
// pipeline. Crude but directionally correct: an LFSR of order L costs roughly
// 2L bytes (coefficients + seed) plus a small constant.
export type ChunkCostEstimator = (buf: Uint8Array) => number

const MODEL_WINDOW        = 32  // bytes examined on each side of a candidate boundary
const MAX_SCAN_CANDIDATES = 64  // hard cap on how many points the cheap scan considers
const MIN_GAIN_THRESHOLD  = 8   // bytes a split must save (after overhead) to be worth it
const SPLIT_OVERHEAD      = 12  // rough per-chunk framing cost (CRC32 + XDNI index entry)

// Distance between two short local LFSR fits — 1 (maximally different) when
// the orders themselves differ, otherwise the fraction of differing
// coefficients. Deliberately simple: this only ranks candidate boundaries,
// it never decides whether to split (the real/cheap cost comparison does).
const modelDistance = (
  a: { length: number; coeffs: number[] },
  b: { length: number; coeffs: number[] }
): number => {
  if (a.length !== b.length) return 1
  if (a.length === 0) return 0
  let diff = 0
  for (let i = 0; i < a.length; i++) if (a.coeffs[i] !== b.coeffs[i]) diff++
  return diff / a.length
}

// Whether the WHOLE buffer plausibly fits one model — sampled at several
// points, not just the start. Checking only the first LC_WINDOW bytes (as the
// old modelStableSplit did) misses exactly the case this priority targets: a
// clean model at the very start with a completely different model appearing
// later, which would otherwise short-circuit the boundary search before it
// ever runs. Returns the shared fit when one consistent model covers every
// sample, else null — used both to gate the search (isSingleModel) and to
// build a cheap whole-buffer cost estimate that doesn't get fooled the same
// way (cheapCostEstimate).
const SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const

const sampleForSingleModel = (buf: Uint8Array): { length: number; coeffs: number[] } | null => {
  if (buf.length <= LC_WINDOW) return addon.bmSolve(Buffer.from(buf))
  let reference: { length: number; coeffs: number[] } | null = null
  for (const f of SAMPLE_FRACTIONS) {
    const p = Math.max(0, Math.min(buf.length - LC_WINDOW, Math.round(f * (buf.length - LC_WINDOW))))
    const fit = addon.bmSolve(Buffer.from(buf.subarray(p, p + LC_WINDOW)))
    if (fit.length > MS_L_CAP) return null
    if (reference === null) reference = fit
    else if (modelDistance(reference, fit) > 0) return null
  }
  return reference
}

const isSingleModel = (buf: Uint8Array): boolean => sampleForSingleModel(buf) !== null

// A buffer that doesn't sample as one clean model anywhere is estimated as
// costing close to its raw size — without a single consistent low-order fit,
// encoding it as one chunk needs either a much higher-order LFSR with a dense
// residual or a raw fallback, both roughly proportional to length. This
// asymmetry (clean = cheap, mixed = ~raw) is what lets stage 2 recognize that
// splitting a mixed buffer into two clean halves is worth it, even though a
// naive single-window sample of just the buffer's start would miss the mixed
// structure entirely and report a falsely tiny whole-buffer cost.
const cheapCostEstimate: ChunkCostEstimator = (buf) => {
  const fit = sampleForSingleModel(buf)
  return fit ? 2 * fit.length + 8 : buf.length + 5
}

// Bounded scan for points where the local model looks like it changes.
// Returns candidate positions sorted by descending model-distance score.
const scanModelBoundaries = (buf: Uint8Array): number[] => {
  const n = buf.length
  const step = Math.max(MODEL_WINDOW, Math.ceil(n / MAX_SCAN_CANDIDATES))
  const scored: { pos: number; score: number }[] = []

  for (let p = MODEL_WINDOW; p <= n - MODEL_WINDOW; p += step) {
    const left  = addon.bmSolve(Buffer.from(buf.subarray(p - MODEL_WINDOW, p)))
    const right = addon.bmSolve(Buffer.from(buf.subarray(p, p + MODEL_WINDOW)))
    scored.push({ pos: p, score: modelDistance(left, right) })
  }

  return scored.sort((a, b) => b.score - a.score).map(s => s.pos)
}

// How many model-distance-ranked candidates advance to the cheap-cost re-rank.
// Independent of (and larger than) budget.maxBoundaryChecks, which instead
// bounds the much more expensive final stage.
const MODEL_DISTANCE_POOL = 8

// Recursively split chunks whose linear complexity is too high for one model.
// Unlike the old blind-midpoint bisection, this runs a three-stage funnel —
// cheap gate -> cheap estimate -> retain finalists -> actual serialization ->
// choose winner, per the roadmap's own candidate-economics pattern, just
// applied to boundary choice instead of representation choice:
//   1. bounded scan for points where the LOCAL model looks like it changes
//      (cheap: short BM fits on either side, no real serialization)
//   2. re-rank the best few of those by a cheap whole-buffer cost estimate
//   3. only the top `budget.maxBoundaryChecks` from step 2 get the expensive
//      real-cost check (encodeCost, e.g. real serialized size), and only the
//      largest verified gain wins
// Random data reliably fails step 3 (splitting it never reduces total real
// cost by more than the framing overhead it adds), so it stays a fast
// rejection case despite sometimes looking "different enough" in step 1.
export const modelAwareSplit = (
  buf: Uint8Array,
  estimateCost: ChunkCostEstimator = cheapCostEstimate,
  budget: SearchBudget = DEFAULT_BUDGET
): Uint8Array[] => {
  if (buf.length < MIN_CHUNK * 2) return [buf]
  if (isSingleModel(buf)) return [buf]  // already fits one model throughout

  const byModelDistance = scanModelBoundaries(buf)
    .filter(p => p >= MIN_CHUNK && buf.length - p >= MIN_CHUNK)
    .slice(0, MODEL_DISTANCE_POOL)
  if (byModelDistance.length === 0) return [buf]

  // Stage 2: cheap-cost re-rank (no real serialization yet).
  const cheapWhole = cheapCostEstimate(buf)
  const byCheapGain = byModelDistance
    .map(p => ({
      p,
      cheapGain: cheapWhole - (cheapCostEstimate(buf.subarray(0, p)) + cheapCostEstimate(buf.subarray(p)) + SPLIT_OVERHEAD),
    }))
    // A tiny positive cheap gain is often just noise from the 20-byte sampling
    // window (a single error inside/outside the window can spike its apparent
    // complexity); require a more meaningful margin before paying for the
    // expensive real check at all.
    .filter(c => c.cheapGain > MIN_GAIN_THRESHOLD / 2)
    .sort((a, b) => b.cheapGain - a.cheapGain)
    .slice(0, budget.maxBoundaryChecks)
  if (byCheapGain.length === 0) return [buf]

  // Stage 3: only these finalists pay for the real (or caller-supplied) cost.
  const wholeCost = estimateCost(buf)
  let bestPos: number | null = null
  let bestGain = MIN_GAIN_THRESHOLD
  for (const { p } of byCheapGain) {
    const splitCost = estimateCost(buf.subarray(0, p)) + estimateCost(buf.subarray(p)) + SPLIT_OVERHEAD
    const gain = wholeCost - splitCost
    if (gain > bestGain) { bestGain = gain; bestPos = p }
  }

  if (bestPos === null) return [buf]

  return [
    ...modelAwareSplit(buf.slice(0, bestPos), estimateCost, budget),
    ...modelAwareSplit(buf.slice(bestPos), estimateCost, budget),
  ]
}

// Split at entropy discontinuities only (no model-aware second pass). Scans at
// half-window steps to catch boundaries between windows; min/max chunk size
// prevents degenerate splits. After detection, each boundary is refined by
// ±4 bytes to snap to the sharpest transition point within the neighbourhood.
export const entropyChunks = (buf: Uint8Array): Uint8Array[] => {
  if (buf.length <= MIN_CHUNK * 2) return [buf]

  const rough: number[] = []

  for (let i = WINDOW; i < buf.length - WINDOW; i += WINDOW >> 1) {
    const last = rough.length ? rough[rough.length - 1]! : 0
    const size = i - last

    if (size >= MAX_CHUNK) { rough.push(i); continue }
    if (size < MIN_CHUNK)  continue

    const before = shannonEntropy(buf.slice(i - WINDOW, i))
    const after  = shannonEntropy(buf.slice(i, i + WINDOW))
    if (Math.abs(after - before) > DELTA_THRESHOLD) rough.push(i)
  }

  // Refine each boundary
  const boundaries = [0]
  for (let k = 0; k < rough.length; k++) {
    const prev = boundaries[boundaries.length - 1]!
    const next = k + 1 < rough.length ? rough[k + 1]! : buf.length
    boundaries.push(refineBoundary(buf, rough[k]!, prev, next))
  }
  boundaries.push(buf.length)

  return boundaries.slice(0, -1).map((s, idx) => buf.slice(s, boundaries[idx + 1]))
}

// Full two-pass chunking: entropy discontinuities, then model-aware splitting
// of each entropy-chunk. Grouped by entropy-chunk origin (each inner array is
// the one-or-more model-aware pieces that came from a single entropy chunk) —
// the encoder uses the grouping to decide between separate top-level chunks
// and one switching-LFSR chunk for pieces that share an origin (Priority 4).
export const adaptiveChunkGroups = (
  buf: Uint8Array,
  estimateCost?: ChunkCostEstimator,
  budget: SearchBudget = DEFAULT_BUDGET
): Uint8Array[][] =>
  entropyChunks(buf).map(c => modelAwareSplit(c, estimateCost, budget))

// Flat convenience wrapper over adaptiveChunkGroups — the common case for
// callers that don't care which model-aware pieces originated together.
export const adaptiveChunks = (
  buf: Uint8Array,
  estimateCost?: ChunkCostEstimator,
  budget: SearchBudget = DEFAULT_BUDGET
): Uint8Array[] =>
  adaptiveChunkGroups(buf, estimateCost, budget).flat()
