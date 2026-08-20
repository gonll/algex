// Priority 2: approximate cyclic detection — periodicity + sparse residual.
//
// Generalizes exact periodicity (encoder.ts's detectCyclic) to "mostly periodic":
// find a period P and a per-position template such that seq[i] == template[i % P]
// for most i, then encode the mismatches as a sparse residual instead of falling
// back to raw or another representation entirely.
//
// Bounded two-phase search, per priority-1's own "cheap estimate -> top-K -> exact"
// pattern:
//   1. Quick pass: for each candidate period, count mismatches against the FIRST
//      cycle only (O(n) per period, no allocation) — cheap enough to sweep every
//      period up to the cap.
//   2. Refine: for the best few candidate periods, build a majority-vote template
//      (the most frequent byte at each position across all repeats — robust to
//      noise landing in the first cycle) and compute the actual residual + size.

import { packedResidualSize } from "../utils/sparse"

export interface ApproxCyclicResult {
  readonly cycle: Uint8Array
  readonly residual: Uint8Array   // length === seq.length; XOR of actual vs tiled template
  readonly mismatches: number
}

const MIN_LEN           = 12   // need a handful of repeats for a period to mean anything
const DEFAULT_MAX_PERIOD = 128 // upper bound for the search — keeps O(maxPeriod * n) bounded
const REFINE_TOP_K       = 3   // candidate periods promoted to full majority-vote treatment
const QUICK_REJECT_RATE  = 0.4 // mismatch density above this can't plausibly beat raw

// Cheap mismatch count comparing each element to its immediate predecessor
// occurrence (seq[i] vs seq[i-P]) rather than always to the first cycle — O(n).
// Anchoring to cycle 0 specifically would bias the pre-filter toward rejecting
// the true period whenever noise happens to land in its first repeat (a large
// multiple of the true period dilutes that same noise across more repeats and
// would otherwise look spuriously cleaner). Comparing consecutive repeats keeps
// any single corrupted repeat's damage local to its two neighboring comparisons.
const quickMismatchCount = (seq: Uint8Array, P: number): number => {
  let mismatches = 0
  for (let i = P; i < seq.length; i++) if (seq[i] !== seq[i - P]!) mismatches++
  return mismatches
}

// For each position j in [0, P), pick the most frequent byte among seq[j], seq[j+P], ...
// Robust to noise in any single repeat, including the first — unlike slicing seq[0..P).
const majorityTemplate = (seq: Uint8Array, P: number): Uint8Array => {
  const template = new Uint8Array(P)
  const counts = new Uint16Array(256)
  for (let j = 0; j < P; j++) {
    counts.fill(0)
    let bestVal = seq[j]!, bestCount = 0
    for (let i = j; i < seq.length; i += P) {
      const c = ++counts[seq[i]!]!
      if (c > bestCount) { bestCount = c; bestVal = seq[i]! }
    }
    template[j] = bestVal
  }
  return template
}

const buildResidual = (seq: Uint8Array, template: Uint8Array): { residual: Uint8Array; mismatches: number } => {
  const residual = new Uint8Array(seq.length)
  let mismatches = 0
  for (let i = 0; i < seq.length; i++) {
    const x = seq[i]! ^ template[i % template.length]!
    residual[i] = x
    if (x !== 0) mismatches++
  }
  return { residual, mismatches }
}

// Bounded search for the smallest-encoding approximate cyclic representation.
// Returns null when no candidate period is even plausibly periodic, or when the
// search bounds (length, maxPeriod) rule out a meaningful search.
export const findApproxCyclic = (
  seq: Uint8Array,
  maxPeriod = DEFAULT_MAX_PERIOD
): ApproxCyclicResult | null => {
  const n = seq.length
  const maxP = Math.min(maxPeriod, Math.floor(n / 3))
  if (n < MIN_LEN || maxP < 2) return null

  const scored: { P: number; rate: number }[] = []
  for (let P = 2; P <= maxP; P++) {
    const rate = quickMismatchCount(seq, P) / (n - P)
    if (rate <= QUICK_REJECT_RATE) scored.push({ P, rate })
  }
  if (scored.length === 0) return null

  // Any true period P0 is trivially "also periodic" at every multiple of P0, and
  // noise-driven fluctuation in the cheap per-period rate can rank a multiple above
  // P0 itself. A larger multiple costs strictly more cycle-storage overhead for no
  // reliable residual benefit (majority voting only gets MORE samples per bucket at
  // the smaller period), so always give the smallest surviving periods a shot at
  // full refinement alongside the ones the quick pass ranked lowest-rate.
  const byRate = [...scored].sort((a, b) => a.rate - b.rate).slice(0, REFINE_TOP_K)
  const bySize = [...scored].sort((a, b) => a.P - b.P).slice(0, 2)
  const finalists = [...new Map([...byRate, ...bySize].map(s => [s.P, s])).values()]

  let best: ApproxCyclicResult | null = null
  let bestSize = Infinity
  for (const { P } of finalists) {
    const template = majorityTemplate(seq, P)
    const { residual, mismatches } = buildResidual(seq, template)
    const size = P + packedResidualSize(residual)
    if (size < bestSize) { bestSize = size; best = { cycle: template, residual, mismatches } }
  }
  return best
}
