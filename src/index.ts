// Public API — compress/decompress bytes and optionally inspect the internals

import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from "zlib"
import { encode, encodeAsync } from "./codec/encoder"
import { decode }              from "./codec/decoder"
import { serialize, deserialize } from "./codec/format"
import { BUDGETS, CompressionMode } from "./codec/search-budget"

// Priority 7: full-file wrapper competition — raw PAD vs gzip(PAD) vs brotli(PAD).
// gzip is self-describing (magic 1f 8b) and raw PAD always starts with 'P' (0x50),
// but brotli has no comparable universal magic, so a brotli-wrapped file gets an
// explicit 1-byte marker prefix. Chosen to collide with neither gzip's 0x1f nor
// PAD's 0x50 so all three forms stay distinguishable without extra metadata.
const BROTLI_MARKER = 0xb2

// Full-file brotli only runs once per compress() call (unlike the per-residual
// pass in format.ts, which runs per chunk) — affording a higher quality setting.
const BROTLI_FILE_QUALITY = 9

// Tries gzip and brotli on the structural pade output; returns whichever is
// smallest, including the uncompressed pade itself (incompressible raw chunks
// can make both wrappers pay header tax for nothing).
export const wrapSmallest = (pade: Uint8Array): Uint8Array => {
  const gz = gzipSync(pade, { level: 9 })
  const br = brotliCompressSync(pade, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_FILE_QUALITY } })

  let best = pade
  if (gz.length < best.length) best = gz
  if (br.length + 1 < best.length) {
    const wrapped = new Uint8Array(1 + br.length)
    wrapped[0] = BROTLI_MARKER
    wrapped.set(br, 1)
    best = wrapped
  }
  return best
}

// Synchronous full pipeline: structural GF(2^8/16) encoding → smallest outer wrapper.
// Output may be raw .pade, gzip-wrapped, or brotli-wrapped — decompress() handles all three.
// mode controls the search budget: "fast" (fewer candidates, quicker), "balanced"
// (default — matches all prior behavior), or "max" (wider search, same bytes or smaller).
export const compress = (input: Uint8Array, mode: CompressionMode = "balanced"): Uint8Array =>
  wrapSmallest(serialize(encode(input, BUDGETS[mode])))

// Decompresses output from compress() or compressAsync().
// Auto-detects gzip (1f 8b) and the brotli marker; falls back to raw PAD3/PAD4/PAD5.
export const decompress = (input: Uint8Array): Uint8Array => {
  let pade: Uint8Array
  if (input[0] === 0x1f && input[1] === 0x8b) pade = gunzipSync(input)
  else if (input[0] === BROTLI_MARKER)        pade = brotliDecompressSync(input.subarray(1))
  else                                        pade = input
  return decode(deserialize(pade))
}

export type ProgressCallback = (done: number, total: number) => void

// Async full pipeline: chunks encoded in parallel across worker threads.
// onProgress is called after each chunk completes with (doneCount, totalCount).
export const compressAsync = async (
  input: Uint8Array,
  workers?: number,
  onProgress?: ProgressCallback,
  mode: CompressionMode = "balanced"
): Promise<Uint8Array> =>
  wrapSmallest(serialize(await encodeAsync(input, workers, onProgress, BUDGETS[mode])))

export { encode, encodeAsync, decode, serialize, deserialize }
export { streamDeserialize, readChunkAt } from "./codec/format"
export { createCompressStream, createDecompressStream } from "./codec/stream"
export { analyzeBuffer, formatAnalysis, toJSON, shouldCompress } from "./core/analysis"
export { WorkerPool } from "./codec/worker-pool"
export { BUDGETS, DEFAULT_BUDGET } from "./codec/search-budget"
export type { CompressedFile, Chunk, LFSR } from "./types"
export type { AnalysisResult, SegmentInfo } from "./core/analysis"
export type { SearchBudget, CompressionMode } from "./codec/search-budget"
export {
  enableCandidateTracing, disableCandidateTracing, isCandidateTracingEnabled,
  getCandidateTrace, clearCandidateTrace,
} from "./codec/candidate-trace"
export type { CandidateTraceEntry, ChunkTrace } from "./codec/candidate-trace"
