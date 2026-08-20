// Encode pipeline (16 paths):
//   0. GF(2^16) BM (even-length chunks — word-level recurrences in 16-bit streams)
//   1. Exact Padé [k/L] offset BM
//   2. Approx L=1 (brute-force 255 GF coefficients)
//   3. Approx L=2 (quadruple voting, covers ~28% noise)
//   4. Approx L=3 (quintuple-pair voting, covers ~23% noise)
//   5. Approx L=4,5 (sub-sequence BM voting for higher-order LFSRs)
//   6. Affine L=1 (y[n] = c*y[n-1] ^ b via shift normalization)
//   7. Cyclic / exact period detection
//   8-10. Delta transforms: XOR diff, ADD diff, XOR 2nd diff (high-entropy gate)
//   11-13. Interleave m=2,3,4 (high-entropy gate, BM pre-screen per lane)
//   14. Bitplane (high-entropy gate, BM pre-screen per plane)
//   15. Raw passthrough

import { Chunk, SimpleChunk, LaneChunk, LFSRChunk, RawChunk, CyclicChunk, ApproxCyclicChunk, CompressedFile, GFElem, LFSR, LFSR16Chunk, NonDeltaChunk, AffineChunk, DeltaChunk, InterleaveChunk, BitplaneChunk, SwitchingLFSRChunk } from "../types"
import { toSeq, fromSeq, xorBytes } from "../utils/buffer"
import { isCompressible } from "../core/entropy"
import { findBestPade, findApproxL1, findApproxL2, findApproxL3, findApproxL4, findApproxL5, findApproxAffineL1, refinedSize } from "../core/pade"
import { shouldTryTransforms, DELTA_TRANSFORMS } from "../core/transform"
import { findApproxCyclic } from "../core/cyclic"
import { packedResidualSize } from "../utils/sparse"
import { splitInterleave } from "../utils/interleave"
import { splitBitplanes } from "../core/bitplane"
import { adaptiveChunkGroups } from "./chunker"
import { serializeChunk, deserializeChunk } from "./format"
import { addon } from "../native/addon"
import { EncodeCandidate, pickBest, realSize } from "./candidates"
import { SearchBudget, DEFAULT_BUDGET } from "./search-budget"

const runLFSR = (lfsr: LFSR, init: GFElem[], n: number): GFElem[] =>
  Array.from(addon.lfsrRun(lfsr.coeffs, Buffer.from(init), n))

const rawSize = (n: number): number => 1 + 4 + n

// After an approximate search finds LFSR coefficients, check whether each seed byte
// looks clean by probing a short window of predictions. If a seed position appears
// noisy (its single-byte error propagates obviously), sweep all 256 candidates for
// that position and pick the one that minimises total residual errors.
//
// Skips chunks above DENOISE_MAX and seed positions that are already clean —
// keeping O(L×256×N) work confined to the rare case where it's actually needed.
const DENOISE_MAX = 512  // beyond this, 256×L×N cost dominates for marginal gain

const denoiseSeed = (
  seq: GFElem[],
  coeffs: GFElem[],
  init: GFElem[]
): GFElem[] => {
  if (seq.length > DENOISE_MAX) return init
  const L    = coeffs.length
  const lfsr = { coeffs, length: L }

  const PROBE = Math.min(4 * L + 8, seq.length)
  const probe = runLFSR(lfsr, init, PROBE)
  let probeErrors = 0
  for (let i = 0; i < PROBE; i++) if (probe[i] !== seq[i]) probeErrors++
  if (probeErrors / PROBE < 0.02) return init

  const best = [...init]
  for (let pos = 0; pos < L; pos++) {
    let bestErrors = Infinity
    let bestVal    = best[pos]!
    for (let v = 0; v < 256; v++) {
      best[pos] = v
      const pred = runLFSR(lfsr, best, seq.length)
      let errors = 0
      for (let i = 0; i < seq.length; i++) {
        if (pred[i] !== seq[i]) errors++
        if (errors >= bestErrors) break
      }
      if (errors < bestErrors) { bestErrors = errors; bestVal = v }
    }
    best[pos] = bestVal
  }
  return best
}

// Detect exact periodicity: find the smallest P such that s[i] = s[i mod P] everywhere.
// Returns the single cycle (P bytes) or null.  Only checks P ≤ max(512, n/2).
const detectCyclic = (seq: GFElem[]): Uint8Array | null => {
  const n = seq.length
  const maxP = Math.min(512, Math.floor(n / 2))

  outer:
  for (let P = 1; P <= maxP; P++) {
    for (let i = P; i < n; i++) {
      if (seq[i] !== seq[i % P]) continue outer
    }
    return Uint8Array.from(seq.slice(0, P))
  }
  return null
}

// Priority 2: approximate cyclic candidate — periodicity + sparse residual.
// Only attempted when exact periodicity (detectCyclic) failed: an exact zero-
// residual fit at a given period can't be beaten by an approximate fit that
// tolerates residual at the very same or a related period, so trying both on
// every chunk would just double the period-search cost for no benefit.
const approxCyclicCandidate = (chunk: Uint8Array, rSize: number): EncodeCandidate | null => {
  const approx = findApproxCyclic(chunk)
  if (!approx) return null
  const est = 1 + 4 + 2 + approx.cycle.length + packedResidualSize(approx.residual)
  if (est >= rSize) return null
  const approxCyclicChunk = {
    kind: "approx-cyclic", cycle: approx.cycle, residual: approx.residual, originalLength: chunk.length,
  } satisfies ApproxCyclicChunk
  return { chunk: approxCyclicChunk, estimatedSize: est, label: "approx-cyclic" }
}

const buildLFSRChunk = (
  chunk: Uint8Array,
  seq: GFElem[],
  offset: number,
  lfsr: { coeffs: number[]; length: number },
  init: GFElem[]
): LFSRChunk => {
  const prefix      = Uint8Array.from(seq.slice(0, offset))
  const lfsrRegion  = seq.slice(offset)
  const predicted   = fromSeq(runLFSR(lfsr, init, lfsrRegion.length))
  const actualBytes = Uint8Array.from(lfsrRegion)
  const residual    = xorBytes(actualBytes, predicted)
  return { kind: "lfsr", prefix, lfsr, init, residual, originalLength: chunk.length }
}

// Try offsets 0..maxOff for an approximate finder; return the best-scoring LFSRChunk
// or null if no offset beats rawSize.
const encodeApproxWithOffset = (
  find: (sub: GFElem[]) => { lfsr: { coeffs: number[]; length: number }; init: GFElem[] } | null,
  seq: GFElem[],
  chunk: Uint8Array,
  L: number
): LFSRChunk | null => {
  const result0 = find(seq)
  if (!result0) return null

  const cand0  = buildLFSRChunk(chunk, seq, 0, result0.lfsr, result0.init)
  const size0  = refinedSize(0, L, cand0.residual)
  const rSize  = rawSize(chunk.length)
  if (size0 < rSize) return cand0

  const maxOff = Math.min(8, seq.length - L - 2)
  let best = cand0
  let bestSize = size0

  for (let off = 1; off <= maxOff; off++) {
    const result = find(seq.slice(off))
    if (!result) continue
    const candidate = buildLFSRChunk(chunk, seq, off, result.lfsr, result.init)
    const size = refinedSize(off, L, candidate.residual)
    if (size < bestSize) { bestSize = size; best = candidate }
    if (bestSize < rSize) break
  }

  return bestSize < rSize ? best : null
}

// Rough wire-size estimate for a simple chunk, without running deflate.
const estimateSimpleBytes = (c: SimpleChunk): number => {
  if (c.kind === "raw")           return 1 + 4 + c.data.length
  if (c.kind === "cyclic")        return 1 + 4 + 2 + c.cycle.length
  if (c.kind === "approx-cyclic") return 1 + 4 + 2 + c.cycle.length + packedResidualSize(c.residual)
  return refinedSize(c.prefix.length, c.lfsr.length, c.residual)
}

// Rough wire-size estimate for a lane/plane entry — a SimpleChunk, or one delta
// transform deep (Priority 6's "interleave/bitplane → delta → LFSR").
const estimateLaneBytes = (c: LaneChunk): number =>
  c.kind === "delta" ? 1 + 4 + 1 + 4 + estimateSimpleBytes(c.inner as SimpleChunk) : estimateSimpleBytes(c)

// Rough wire-size estimate for any NonDeltaChunk (used to evaluate delta wrappers).
const estimateNonDeltaBytes = (c: NonDeltaChunk): number => {
  if (c.kind === "raw" || c.kind === "cyclic" || c.kind === "lfsr" || c.kind === "approx-cyclic")
    return estimateSimpleBytes(c)
  if (c.kind === "lfsr16") {
    const L16 = c.coeffs.length
    const nonZero = c.residual.filter(b => b !== 0).length
    const resBytes = nonZero * 2 < c.residual.length ? nonZero * 2 + 1 : c.residual.length + 1
    return 1 + 4 + 1 + L16 * 4 + resBytes
  }
  if (c.kind === "affine")
    return 1 + 4 + 1 + 4 + estimateSimpleBytes(c.inner)
  if (c.kind === "interleave")
    return 1 + 4 + 1 + c.lanes.reduce((s, l) => s + 4 + estimateLaneBytes(l), 0)
  // bitplane
  return 1 + 4 + 1 + c.planes.reduce((s, p) => s + 4 + estimateLaneBytes(p), 0)
}

const withDenoise = (
  r: { lfsr: { coeffs: number[]; length: number }; init: GFElem[]; nonZeroCount: number },
  sub: GFElem[]
) => {
  const needsDenoise = sub.length <= DENOISE_MAX && r.nonZeroCount / sub.length > 0.05
  return { lfsr: r.lfsr, init: needsDenoise ? denoiseSeed(sub, r.lfsr.coeffs, r.init) : r.init }
}

// ── searchLFSRCandidates: paths 1-5 (exact + approx L=1..5) ──────────────────
//
// Shared by both encodeChunkCore and encodeChunkInner. Collects every LFSR
// representation that beats raw by its own cheap estimate — exact BM and each
// approximate order L=1..5 — instead of returning the first one found, so the
// caller can pick the smallest by actual serialized size (Priority 1).
const APPROX_FINDERS: ReadonlyArray<{
  readonly label: string
  readonly L: number
  readonly find: (sub: GFElem[]) => { lfsr: LFSR; init: GFElem[]; nonZeroCount: number } | null
}> = [
  { label: "approxL1", L: 1, find: findApproxL1 },
  { label: "approxL2", L: 2, find: findApproxL2 },
  { label: "approxL3", L: 3, find: findApproxL3 },
  { label: "approxL4", L: 4, find: findApproxL4 },
  { label: "approxL5", L: 5, find: findApproxL5 },
]

// Highest order APPROX_FINDERS searches. Exact BM (Berlekamp-Massey) always
// reproduces the sequence with zero residual by construction — so when the exact
// fit already has order ≤ MAX_APPROX_L, no approximate search over the same order
// range can possibly beat it (residual-tolerant search cannot improve on zero
// residual at an order it could itself have reached). Skipping approx in that case
// avoids ~5 extra native searches per chunk for the common clean-LFSR case.
const MAX_APPROX_L = 5

const searchLFSRCandidates = (chunk: Uint8Array, seq: GFElem[], budget: SearchBudget): EncodeCandidate[] => {
  const candidates: EncodeCandidate[] = []

  const { offset, lfsr, init } = findBestPade(seq)
  if (isCompressible(chunk, lfsr.length)) {
    const candidate = buildLFSRChunk(chunk, seq, offset, lfsr, init)
    const size = refinedSize(offset, lfsr.length, candidate.residual)
    if (size < rawSize(chunk.length)) {
      candidates.push({ chunk: candidate, estimatedSize: size, label: "exact" })
      if (lfsr.length <= MAX_APPROX_L) return candidates
    }
  }

  // Budget-bounded: maxModelSolves caps how many approximate orders get tried
  // (fast mode tries only L=1..2; balanced/max try the full L=1..5 ladder).
  for (const { label, L, find } of APPROX_FINDERS.slice(0, budget.maxModelSolves)) {
    const candidate = encodeApproxWithOffset(sub => { const r = find(sub); return r ? withDenoise(r, sub) : null }, seq, chunk, L)
    if (candidate) candidates.push({ chunk: candidate, estimatedSize: estimateSimpleBytes(candidate), label })
  }

  return candidates
}

// ── tryLFSR16: GF(2^16) path (path 0) ────────────────────────────────────────
//
// Treats byte pairs as uint16 LE elements and runs BM over GF(2^16).
// Useful for 16-bit ADC/DAC streams where the word-level recurrence is shorter
// than the byte-level one found by GF(2^8) BM.  Even-length chunks only.
const tryLFSR16 = (chunk: Uint8Array): LFSR16Chunk | null => {
  if (chunk.length % 2 !== 0 || chunk.length < 8) return null
  const buf    = Buffer.from(chunk)
  const result = addon.bm16Solve(buf)
  const L16    = result.length
  if (L16 === 0 || L16 > 32 || L16 * 4 >= chunk.length) return null

  const wordCount = chunk.length / 2
  const seedBuf   = buf.slice(0, L16 * 2)
  const predicted = addon.lfsr16Run(result.coeffs, seedBuf, wordCount)
  const predArr   = new Uint8Array(predicted.buffer, predicted.byteOffset, predicted.byteLength)

  const residual = new Uint8Array(chunk.length)
  let nonZero = 0
  for (let i = 0; i < chunk.length; i++) {
    residual[i] = chunk[i]! ^ predArr[i]!
    if (residual[i] !== 0) nonZero++
  }

  const resBytes = nonZero * 2 < chunk.length ? nonZero * 2 + 1 : chunk.length + 1
  const wireSize = 1 + 4 + 1 + L16 * 4 + resBytes
  if (wireSize >= rawSize(chunk.length)) return null

  return { kind: "lfsr16", coeffs: result.coeffs, seed: Uint8Array.from(seedBuf), residual, originalLength: chunk.length }
}

// ── encodeChunkCore: structural paths only (LFSR + cyclic) ───────────────────
//
// Used when encoding transformed or interleaved/bitplane sub-sequences where
// wrapper overhead is already accounted for by the caller. Collects every
// candidate that beats raw by cheap estimate and picks the smallest by actual
// serialized size (Priority 1) instead of the first one found.
const encodeChunkCore = (chunk: Uint8Array, budget: SearchBudget = DEFAULT_BUDGET): SimpleChunk => {
  const seq   = toSeq(chunk)
  const rSize = rawSize(chunk.length)

  const candidates: EncodeCandidate[] = [
    { chunk: { kind: "raw", data: chunk } satisfies RawChunk, estimatedSize: rSize, label: "raw" },
  ]

  const lfsrCandidates = searchLFSRCandidates(chunk, seq, budget)
  candidates.push(...lfsrCandidates)

  const cycle = detectCyclic(seq)
  if (cycle !== null) {
    const est = 1 + 4 + 2 + cycle.length
    if (est < rSize)
      candidates.push({ chunk: { kind: "cyclic", cycle, originalLength: chunk.length } satisfies CyclicChunk, estimatedSize: est, label: "cyclic" })
  } else {
    // Roadmap 2, Priority 8 (profiling): findApproxCyclic's bounded period
    // sweep is the single largest JS hotspot in the whole encoder. An "exact"
    // LFSR candidate always has zero residual by construction (Berlekamp-
    // Massey), so a tight one (small relative to raw) is already a strong,
    // near-optimal fit that periodicity-plus-noise is very unlikely to beat —
    // skip the expensive sweep rather than pay for a comparison that
    // essentially never wins.
    const hasCleanExactFit = lfsrCandidates.some(c => c.label === "exact" && c.estimatedSize < rSize * 0.2)
    if (!hasCleanExactFit) {
      const approxCyclic = approxCyclicCandidate(chunk, rSize)
      if (approxCyclic) candidates.push(approxCyclic)
    }
  }

  return pickBest(candidates, budget.maxExpensiveCandidates, "core") as SimpleChunk
}

// ── encodeLane: lane/plane encoder with one optional delta wrap (Priority 6) ──
//
// Adds the missing "interleave/bitplane → delta → LFSR" composition from the
// prompt's beam-search examples on top of encodeChunkCore's structural search.
// Bounded to depth 1 beyond encodeChunkCore (a lane's delta always wraps a
// SimpleChunk, never a further nested interleave/bitplane/affine), using the
// same actual-size candidate competition as encodeChunk's top-level delta wrap.
const encodeLane = (chunk: Uint8Array, budget: SearchBudget, depth: number): LaneChunk => {
  const core  = encodeChunkCore(chunk, budget)
  const rSize = rawSize(chunk.length)

  const candidates: EncodeCandidate[] = [
    { chunk: core, estimatedSize: core.kind === "raw" ? rSize : estimateSimpleBytes(core), label: "lane-core" },
  ]

  // `depth` already counts the interleave/bitplane level the caller is inside;
  // the delta wrap would add one more level on top of that.
  if (depth + 1 <= budget.maxTransformDepth && shouldTryTransforms(chunk)) {
    const DELTA_OVERHEAD = 10
    for (const dt of DELTA_TRANSFORMS) {
      const transformed = dt.apply(chunk)
      const inner = encodeChunkCore(transformed, budget)
      if (inner.kind === "raw") continue
      const est = DELTA_OVERHEAD + estimateSimpleBytes(inner)
      if (est < rSize) {
        const deltaChunk = { kind: "delta", deltaId: dt.id, inner, originalLength: chunk.length } satisfies DeltaChunk
        candidates.push({ chunk: deltaChunk, estimatedSize: est, label: `lane-delta${dt.id}` })
      }
    }
  }

  return pickBest(candidates, budget.maxExpensiveCandidates, "lane") as LaneChunk
}

// ── encodeChunkInner: all non-delta paths ─────────────────────────────────────
//
// Used as the inner encoder for delta wrappers (depth-2 compositions like
// delta(affine), delta(interleave), delta(lfsr16)).  Excludes delta itself
// to prevent useless delta-of-delta nesting.
//
// Collects every candidate representation (GF(2^8) LFSR at every order, GF(2^16),
// affine, cyclic) that beats raw by cheap estimate, then picks the smallest by
// actual serialized size (Priority 1) instead of returning the first match.
// Interleave/bitplane search is comparatively expensive — recursive per-lane/plane
// candidate search — and rarely beats a direct whole-chunk structural match when
// one exists, so it only runs when nothing structural was found for the chunk.
const encodeChunkInner = (chunk: Uint8Array, budget: SearchBudget = DEFAULT_BUDGET, depth = 0): NonDeltaChunk => {
  const seq   = toSeq(chunk)
  const rSize = rawSize(chunk.length)

  const candidates: EncodeCandidate[] = [
    { chunk: { kind: "raw", data: chunk } satisfies RawChunk, estimatedSize: rSize, label: "raw" },
  ]

  // GF(2^8) paths first — preferred for byte-structured data (firmware, PRBS streams).
  // GF(2^16) is a fallback for word-level recurrences (ADC/DAC, 16-bit samples).
  const lfsrCandidates = searchLFSRCandidates(chunk, seq, budget)
  candidates.push(...lfsrCandidates)

  const lfsr16 = tryLFSR16(chunk)
  if (lfsr16) candidates.push({ chunk: lfsr16, estimatedSize: estimateNonDeltaBytes(lfsr16), label: "lfsr16" })

  const affineResult = tryAffine(chunk, seq)
  if (affineResult) {
    const affineChunk = { kind: "affine", k: affineResult.k, inner: affineResult.inner, originalLength: chunk.length } satisfies AffineChunk
    candidates.push({ chunk: affineChunk, estimatedSize: estimateNonDeltaBytes(affineChunk), label: "affine" })
  }

  const cycle = detectCyclic(seq)
  if (cycle !== null) {
    const est = 1 + 4 + 2 + cycle.length
    if (est < rSize)
      candidates.push({ chunk: { kind: "cyclic", cycle, originalLength: chunk.length } satisfies CyclicChunk, estimatedSize: est, label: "cyclic" })
  } else {
    // See the matching comment in encodeChunkCore — skip the expensive
    // approx-cyclic sweep once a tight exact (zero-residual) LFSR fit exists.
    const hasCleanExactFit = lfsrCandidates.some(c => c.label === "exact" && c.estimatedSize < rSize * 0.2)
    if (!hasCleanExactFit) {
      const approxCyclic = approxCyclicCandidate(chunk, rSize)
      if (approxCyclic) candidates.push(approxCyclic)
    }
  }

  // Interleave/bitplane themselves count as one transform level (depth+1) —
  // only worth considering if that still fits the budget.
  if (candidates.length === 1 && depth + 1 <= budget.maxTransformDepth && shouldTryTransforms(chunk)) {
    const INTERLEAVE_OVERHEAD = 6
    const BITPLANE_OVERHEAD   = 6

    for (const m of [2, 3, 4]) {
      const lanes = splitInterleave(chunk, m)
      if (!lanes.every(laneIsStructured)) continue
      const encodedLanes = lanes.map(l => encodeLane(l, budget, depth + 1))
      if (!encodedLanes.some(l => l.kind !== "raw")) continue
      const laneBytes = encodedLanes.reduce((s, l) => s + 4 + estimateLaneBytes(l), 0)
      const est = INTERLEAVE_OVERHEAD + laneBytes
      if (est < rSize) {
        const interleaveChunk = { kind: "interleave", m, lanes: encodedLanes, originalLength: chunk.length } satisfies InterleaveChunk
        candidates.push({ chunk: interleaveChunk, estimatedSize: est, label: `interleave${m}` })
      }
    }

    const planes = splitBitplanes(chunk)
    if (planes.every(laneIsStructured)) {
      const encodedPlanes = planes.map(p => encodeLane(p, budget, depth + 1))
      if (encodedPlanes.some(p => p.kind !== "raw")) {
        const planeBytes = encodedPlanes.reduce((s, p) => s + 4 + estimateLaneBytes(p), 0)
        const est = BITPLANE_OVERHEAD + planeBytes
        if (est < rSize) {
          const bitplaneChunk = { kind: "bitplane", planes: encodedPlanes, originalLength: chunk.length } satisfies BitplaneChunk
          candidates.push({ chunk: bitplaneChunk, estimatedSize: est, label: "bitplane" })
        }
      }
    }
  }

  return pickBest(candidates, budget.maxExpensiveCandidates, "inner") as NonDeltaChunk
}

const tryAffine = (chunk: Uint8Array, seq: GFElem[]) => {
  const r = findApproxAffineL1(seq)
  if (!r) return null
  const shifted = seq.map(v => v ^ r.k) as GFElem[]
  const inner   = buildLFSRChunk(chunk, shifted, 0, r.lfsr, r.init)
  const totalBytes = 1 + 4 + 1 + 4 + estimateSimpleBytes(inner)
  if (totalBytes >= rawSize(chunk.length)) return null
  return { k: r.k, inner }
}

// Short BM window used as a cheap gate before running full lane/plane encoding.
const BM_GATE_WINDOW = 20
const BM_GATE_CAP    = 5

const laneIsStructured = (lane: Uint8Array): boolean => {
  if (lane.length < 4) return false
  const window = lane.subarray(0, Math.min(lane.length, BM_GATE_WINDOW))
  if (addon.bmSolve(Buffer.from(window)).length <= BM_GATE_CAP) return true
  // Priority 6: also accept a lane that only looks structured after a delta
  // transform (e.g. an arithmetic counter is trivial post ADD-delta but not
  // directly GF(2^8)-linear) — encodeLane tries delta wrapping for this case.
  return DELTA_TRANSFORMS.some(dt => addon.bmSolve(Buffer.from(dt.apply(window))).length <= BM_GATE_CAP)
}

// ── encodeChunk: top-level entry point ────────────────────────────────────────
//
// Compares the whole-chunk representation against every delta-wrapped variant
// by actual serialized size (Priority 1), instead of returning the first delta
// transform whose cheap estimate beats raw.
export const encodeChunk = (chunk: Uint8Array, budget: SearchBudget = DEFAULT_BUDGET): Chunk => {
  const rSize = rawSize(chunk.length)

  // ── Paths 0-7: structural paths (GF16, GF8 LFSR, affine, cyclic) + interleave/bitplane ──
  const core = encodeChunkInner(chunk, budget, 0)

  const candidates: EncodeCandidate[] = [
    { chunk: core, estimatedSize: core.kind === "raw" ? rSize : estimateNonDeltaBytes(core), label: "core" },
  ]

  // ── Paths 8-10: delta transforms (high-entropy + algebraic gate) ──
  // Inner encoding uses encodeChunkInner (not encodeChunkCore) to enable depth-2
  // compositions: delta(affine), delta(lfsr16), delta(interleave), delta(bitplane).
  // Delta itself is depth 1; its inner call is told depth=1 so a further nested
  // interleave/bitplane inside it only runs if the budget allows depth 2.
  if (budget.maxTransformDepth >= 1 && shouldTryTransforms(chunk)) {
    const DELTA_OVERHEAD = 10  // kind(1) + origLen(4) + deltaId(1) + innerLen(4)

    for (const dt of DELTA_TRANSFORMS) {
      const transformed = dt.apply(chunk)
      const inner = encodeChunkInner(transformed, budget, 1)
      if (inner.kind === "raw") continue
      const est = DELTA_OVERHEAD + estimateNonDeltaBytes(inner)
      if (est < rSize) {
        const deltaChunk = { kind: "delta", deltaId: dt.id, inner, originalLength: chunk.length } satisfies DeltaChunk
        candidates.push({ chunk: deltaChunk, estimatedSize: est, label: `delta${dt.id}` })
      }
    }
  }

  return pickBest(candidates, budget.maxExpensiveCandidates, "top-level") as Chunk
}

// Merge adjacent LFSR chunks that share identical coefficients and a continuous LFSR
// state (end-state of chunk N equals init of chunk N+1).  Eliminates per-chunk header
// overhead for long homogeneous segments, which can dominate for small chunks.
const concatUint8 = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length)
  out.set(a); out.set(b, a.length)
  return out
}

const coeffsMatch = (a: { coeffs: number[]; length: number }, b: { coeffs: number[]; length: number }): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a.coeffs[i] !== b.coeffs[i]) return false
  return true
}

const mergeCompatibleChunks = (chunks: Chunk[]): Chunk[] => {
  const result: Chunk[] = []
  let i = 0
  while (i < chunks.length) {
    const curr = chunks[i]!
    if (curr.kind !== "lfsr") { result.push(curr); i++; continue }

    const L = curr.lfsr.length
    const regionLen = curr.originalLength - curr.prefix.length
    let endState: GFElem[] = runLFSR(curr.lfsr, curr.init, regionLen).slice(-L)

    let merged: LFSRChunk = curr
    let j = i + 1

    while (j < chunks.length) {
      const next = chunks[j]!
      if (next.kind !== "lfsr") break
      if (!coeffsMatch(merged.lfsr, next.lfsr)) break
      if (next.prefix.length > 0) break

      const continuation = runLFSR(merged.lfsr, endState, 2 * L).slice(L)
      let continuous = true
      for (let k = 0; k < L; k++) {
        if (continuation[k] !== next.init[k]) { continuous = false; break }
      }
      if (!continuous) break

      const nextRegionLen = next.originalLength
      endState = runLFSR(next.lfsr, next.init, nextRegionLen).slice(-L)

      merged = {
        kind:           "lfsr",
        prefix:         merged.prefix,
        lfsr:           merged.lfsr,
        init:           merged.init,
        residual:       concatUint8(merged.residual, next.residual),
        originalLength: merged.originalLength + next.originalLength,
      }
      j++
    }

    result.push(merged)
    i = j
  }
  return result
}

// Real (not heuristic) per-chunk cost estimate for the model-aware chunker:
// actual serialized size of the structural-only encoding (LFSR/cyclic/approx-
// cyclic), skipping delta/interleave/bitplane search — accurate enough to make
// good split-vs-unsplit decisions without paying for the full candidate
// pipeline on every boundary the chunker considers.
const chunkCost = (budget: SearchBudget) => (buf: Uint8Array): number => realSize(encodeChunkCore(buf, budget))

// ── Switching-LFSR: bundle adjacent model-aware pieces into one envelope ─────
//
// Roadmap 2, Priority 4. When the model-aware chunker splits one entropy-chunk
// into several pieces, each piece becomes its own top-level chunk by default —
// each paying its own kind/origLen/CRC32/XDNI-index framing. If every piece's
// best structural fit is a clean (zero-prefix) LFSR, bundling them into one
// switching-LFSR chunk trades that per-piece framing for a single shared
// envelope. Only built as a candidate to compare against separate chunks —
// per the roadmap's own framing, "the cost model should decide: two top-level
// chunks vs one switching-LFSR chunk," never assumed to win.
const buildSwitchingCandidate = (pieces: readonly Uint8Array[], budget: SearchBudget): SwitchingLFSRChunk | null => {
  const cores = pieces.map(p => encodeChunkCore(p, budget))
  if (!cores.every((c): c is LFSRChunk => c.kind === "lfsr" && c.prefix.length === 0)) return null

  const segments = cores.map((c, i) => ({
    lfsr: c.lfsr, init: c.init, residual: c.residual, segmentLength: pieces[i]!.length,
  }))
  return {
    kind: "switching-lfsr",
    segments,
    originalLength: pieces.reduce((s, p) => s + p.length, 0),
  }
}

// Decide between separate top-level chunks and one switching-LFSR chunk for a
// group of pieces that came from the same entropy-chunk, given the pieces'
// already-computed separate encodings (shared by the sync and worker-parallel
// paths so both make the identical decision from identical inputs).
// Per-chunk top-level framing a switching-LFSR chunk can avoid paying for
// every piece but the first: kind(1) + origLen(4) + CRC32(4) + XDNI entry(8).
const PER_CHUNK_FRAMING = 17

const chooseGroupEncoding = (pieces: readonly Uint8Array[], separate: readonly Chunk[], budget: SearchBudget): Chunk[] => {
  if (pieces.length < 2) return separate as Chunk[]
  // Cheap pre-filter: the most this group could possibly save is
  // (pieces.length - 1) * PER_CHUNK_FRAMING bytes of avoided framing. Skip the
  // expensive verification (re-running encodeChunkCore per piece) when that
  // ceiling is small relative to the pieces' own size — not worth the search.
  const totalLen = pieces.reduce((s, p) => s + p.length, 0)
  if ((pieces.length - 1) * PER_CHUNK_FRAMING < totalLen * 0.01) return separate as Chunk[]

  const switching = buildSwitchingCandidate(pieces, budget)
  if (!switching) return separate as Chunk[]

  const separateTotal  = separate.reduce((s, c) => s + realSize(c), 0)
  const switchingTotal = realSize(switching)
  return switchingTotal < separateTotal ? [switching] : (separate as Chunk[])
}

// Encode one group of pieces that came from the same entropy-chunk (a single
// piece if the model-aware chunker didn't split it) — separate top-level
// chunks by default, or one switching-LFSR chunk when that's actually smaller.
const encodeGroup = (pieces: readonly Uint8Array[], budget: SearchBudget): Chunk[] =>
  chooseGroupEncoding(pieces, pieces.map(p => encodeChunk(p, budget)), budget)

// Synchronous encode: all chunks in the calling thread
export const encode = (buf: Uint8Array, budget: SearchBudget = DEFAULT_BUDGET): CompressedFile => ({
  chunks: mergeCompatibleChunks(
    adaptiveChunkGroups(buf, chunkCost(budget), budget).flatMap(pieces => encodeGroup(pieces, budget))
  ),
  originalSize: buf.length,
})

// Async encode: chunks distributed across a worker thread pool for parallelism.
// Falls back to synchronous if workers fail to initialise (e.g. no tsx loader).
// budget is forwarded to every worker so async and sync encode stay byte-identical
// for the same input regardless of how work is scheduled across threads.
// Grouping (for the switching-LFSR decision) is computed once in the calling
// thread and preserved across the worker round-trip — each individual piece's
// encodeChunk still runs in parallel across workers, but the separate-vs-
// switching choice for a multi-piece group is made afterward from those
// results, identically to the sync path, so the two never diverge.
export const encodeAsync = async (
  buf: Uint8Array,
  workers?: number,
  onProgress?: (done: number, total: number) => void,
  budget: SearchBudget = DEFAULT_BUDGET
): Promise<CompressedFile> => {
  const groups = adaptiveChunkGroups(buf, chunkCost(budget), budget)
  const pieces = groups.flat()
  const total  = pieces.length

  let pool: import("./worker-pool").WorkerPool | null = null
  try {
    const { WorkerPool } = await import("./worker-pool")
    pool = new WorkerPool(workers)
  } catch {
    return encode(buf, budget)
  }

  try {
    let done = 0
    const serializedChunks = await Promise.all(
      pieces.map(async piece => {
        const copy   = new Uint8Array(piece)
        const result = await pool!.encode(copy.buffer, budget)
        onProgress?.(++done, total)
        return result
      })
    )
    const decoded = serializedChunks.map(ab => deserializeChunk(new Uint8Array(ab)))

    const finalChunks: Chunk[] = []
    let idx = 0
    for (const groupPieces of groups) {
      const groupResults = decoded.slice(idx, idx + groupPieces.length)
      idx += groupPieces.length
      finalChunks.push(...chooseGroupEncoding(groupPieces, groupResults, budget))
    }

    return { chunks: mergeCompatibleChunks(finalChunks), originalSize: buf.length }
  } finally {
    await pool.terminate()
  }
}
