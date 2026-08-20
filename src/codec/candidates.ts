// Candidate abstraction for actual-size-driven representation selection (Priority 1).
//
// Several encode paths can produce more than one plausible representation for the
// same input bytes (different LFSR orders, cyclic, delta-wrapped variants, ...).
// Instead of returning the first representation that merely beats raw, callers
// collect all plausible candidates scored by a cheap estimate, then re-rank a
// bounded finalist set by actual serialized wire size.

import { Chunk } from "../types"
import { serializeChunk } from "./format"
import { DEFAULT_BUDGET } from "./search-budget"
import { isCandidateTracingEnabled, recordChunkTrace } from "./candidate-trace"

export interface EncodeCandidate {
  readonly chunk: Chunk
  readonly estimatedSize: number  // cheap, pre-serialization estimate — used only for ranking/filtering
  readonly label: string          // human-readable tag for debugging/benchmarks
}

// Actual wire size, including nested chunk overhead and the chosen residual codec
// (plain/deflate/brotli). Expensive for LFSR/LFSR16 chunks — runs both compressors —
// so callers must only call this on a bounded finalist set, never on every candidate.
export const realSize = (chunk: Chunk): number => serializeChunk(chunk).length

const chunkLength = (c: Chunk): number => c.kind === "raw" ? c.data.length : c.originalLength

// Rank candidates by cheap estimate, serialize only the top `k` for real size,
// and return the smallest actual representation. Returns null for an empty list.
// `site` is only used for candidate tracing (a no-op unless tracing is enabled).
export const pickBest = (
  candidates: readonly EncodeCandidate[],
  k = DEFAULT_BUDGET.maxExpensiveCandidates,
  site = "unknown"
): Chunk | null => {
  if (candidates.length === 0) return null

  const sorted = candidates.length <= k
    ? candidates
    : [...candidates].sort((a, b) => a.estimatedSize - b.estimatedSize)
  const finalists = sorted.slice(0, k)
  const finalistSet = new Set(finalists)

  let best     = finalists[0]!.chunk
  let bestSize = realSize(best)
  let bestLabel = finalists[0]!.label
  for (let i = 1; i < finalists.length; i++) {
    const size = realSize(finalists[i]!.chunk)
    if (size < bestSize) { bestSize = size; best = finalists[i]!.chunk; bestLabel = finalists[i]!.label }
  }

  if (isCandidateTracingEnabled()) {
    recordChunkTrace({
      site,
      originalLength: chunkLength(best),
      candidates: sorted.map(c => ({
        label: c.label,
        estimatedBytes: c.estimatedSize,
        actualBytes: finalistSet.has(c) ? realSize(c.chunk) : undefined,
        rejectedReason: finalistSet.has(c) ? undefined : "not a finalist (cheap-estimate cutoff)",
      })),
      winner: bestLabel,
    })
  }

  return best
}
