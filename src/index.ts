// Public API — compress/decompress bytes and optionally inspect the internals

import { gzipSync, gunzipSync } from "zlib"
import { encode, encodeAsync } from "./codec/encoder"
import { decode }              from "./codec/decoder"
import { serialize, deserialize } from "./codec/format"

// Tries gzip on the structural pade output and returns whichever is smaller.
// Incompressible raw chunks produce pade bytes that gzip can't shrink further,
// so the original is returned to avoid paying the ~18-byte gzip header tax.
const smallerOfGzip = (pade: Uint8Array): Uint8Array => {
  const gz = gzipSync(pade, { level: 9 })
  return gz.length < pade.length ? gz : pade
}

// Synchronous full pipeline: structural GF(2^8/16) encoding → gzip wrapper if it helps.
// Output may be gzip-wrapped (.pade inside gzip) or raw .pade — decompress() handles both.
export const compress = (input: Uint8Array): Uint8Array =>
  smallerOfGzip(serialize(encode(input)))

// Decompresses output from compress() or compressAsync().
// Auto-detects gzip wrapper (magic bytes 1f 8b) and falls back to raw PAD4 format.
export const decompress = (input: Uint8Array): Uint8Array => {
  const pade = (input[0] === 0x1f && input[1] === 0x8b) ? gunzipSync(input) : input
  return decode(deserialize(pade))
}

export type ProgressCallback = (done: number, total: number) => void

// Async full pipeline: chunks encoded in parallel across worker threads.
// onProgress is called after each chunk completes with (doneCount, totalCount).
export const compressAsync = async (
  input: Uint8Array,
  workers?: number,
  onProgress?: ProgressCallback
): Promise<Uint8Array> =>
  smallerOfGzip(serialize(await encodeAsync(input, workers, onProgress)))

export { encode, encodeAsync, decode, serialize, deserialize }
export { streamDeserialize, readChunkAt } from "./codec/format"
export { createCompressStream, createDecompressStream } from "./codec/stream"
export { analyzeBuffer, formatAnalysis, toJSON, shouldCompress } from "./core/analysis"
export { WorkerPool } from "./codec/worker-pool"
export type { CompressedFile, Chunk, LFSR } from "./types"
export type { AnalysisResult, SegmentInfo } from "./core/analysis"
