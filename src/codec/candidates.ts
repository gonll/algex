// Candidate abstraction for actual-size-driven representation selection (Priority 1).
//
// Several encode paths can produce more than one plausible representation for the
// same input bytes (different LFSR orders, cyclic, delta-wrapped variants, ...).
// Instead of returning the first representation that merely beats raw, callers
// collect all plausible candidates scored by a cheap estimate, then re-rank a
// bounded finalist set by actual serialized wire size.

import { Chunk } from "../types"
import { serializeChunk } from "./format"

export interface EncodeCandidate {
  readonly chunk: Chunk
  readonly estimatedSize: number  // cheap, pre-serialization estimate — used only for ranking/filtering
  readonly label: string          // human-readable tag for debugging/benchmarks
}

// Actual wire size, including nested chunk overhead and the chosen residual codec
// (plain/deflate/brotli). Expensive for LFSR/LFSR16 chunks — runs both compressors —
// so callers must only call this on a bounded finalist set, never on every candidate.
export const realSize = (chunk: Chunk): number => serializeChunk(chunk).length

// Rank candidates by cheap estimate, serialize only the top `k` for real size,
// and return the smallest actual representation. Returns null for an empty list.
export const pickBest = (candidates: readonly EncodeCandidate[], k = 4): Chunk | null => {
  if (candidates.length === 0) return null

  const finalists = candidates.length <= k
    ? candidates
    : [...candidates].sort((a, b) => a.estimatedSize - b.estimatedSize).slice(0, k)

  let best     = finalists[0]!.chunk
  let bestSize = realSize(best)
  for (let i = 1; i < finalists.length; i++) {
    const size = realSize(finalists[i]!.chunk)
    if (size < bestSize) { bestSize = size; best = finalists[i]!.chunk }
  }
  return best
}
