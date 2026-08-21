// Public API — compress/decompress bytes and optionally inspect the internals

import * as zlib from "zlib"
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from "zlib"
import { encode, encodeAsync } from "./codec/encoder"
import { decode }              from "./codec/decoder"
import { serialize, deserialize } from "./codec/format"
import { BUDGETS, CompressionMode } from "./codec/search-budget"

// Node 22.15+ ships real libzstd bindings in the built-in zlib module — no
// external dependency needed — but this package's stated floor is Node >=18
// (package.json engines), and @types/node hasn't caught up to type these yet
// either. Feature-detect at runtime and fall back to gzip everywhere below
// when unavailable, so compress()/decompress() never throws on an older
// supported Node version; only gains zstd opportunistically where it exists.
type ZstdSync = (buf: Uint8Array, opts?: { params?: Record<number, number> }) => Buffer
const zstdCompressSync: ZstdSync | undefined = (zlib as unknown as { zstdCompressSync?: ZstdSync }).zstdCompressSync
const zstdDecompressSync: ((buf: Uint8Array) => Buffer) | undefined =
  (zlib as unknown as { zstdDecompressSync?: (buf: Uint8Array) => Buffer }).zstdDecompressSync
const ZSTD_C_COMPRESSION_LEVEL = 100  // constants.ZSTD_c_compressionLevel — untyped in @types/node@20

// Priority 7 (roadmap 1) / roadmap 3: full-file wrapper competition — raw PAD
// vs zstd(PAD) vs brotli(PAD). Both zstd and gzip are self-describing (zstd's
// frame magic is 28 b5 2f fd, gzip's is 1f 8b) and raw PAD always starts with
// 'P' (0x50), but brotli has no comparable universal magic, so a brotli-
// wrapped file gets an explicit 1-byte marker prefix. Chosen to collide with
// neither gzip's, zstd's, nor PAD's leading byte so every form stays
// distinguishable without extra metadata.
const BROTLI_MARKER = 0xb2

// Full-file brotli only runs once per compress() call (unlike the per-residual
// pass in format.ts, which runs per chunk) — affording a higher quality setting.
// Max quality (11): on real-world non-algebraic content (compiled binaries),
// quality 9 left the codec measurably behind plain brotli-11 alone, which
// defeats the point of this fallback existing — see scripts/bench-real-world.ts.
const BROTLI_FILE_QUALITY = 11

// zstd, where available, replaces gzip as the "cheap tier" competitor:
// measured strictly smaller AND faster than gzip-9 on every corpus tested,
// including the codec's own near-incompressible structural output — see
// scripts/bench-zstd-feasibility.ts. Level 19 costs ~100-200ms on real-world-
// sized input, negligible next to brotli-11's ~1.5s. Falls back to gzip on
// Node <22.15, where zstd isn't available.
const ZSTD_FILE_LEVEL = 19

const cheapTierCompress = (pade: Uint8Array): Uint8Array =>
  zstdCompressSync
    ? zstdCompressSync(pade, { params: { [ZSTD_C_COMPRESSION_LEVEL]: ZSTD_FILE_LEVEL } })
    : gzipSync(pade, { level: 9 })

// Tries the cheap tier (zstd, or gzip as a fallback) and — outside fast mode —
// brotli on the structural pade output; returns whichever is smallest,
// including the uncompressed pade itself (incompressible raw chunks can make
// both wrappers pay header tax for nothing). Brotli-11 always won on ratio in
// real-world testing, but it's also the single most expensive step in the
// whole pipeline — "fast" mode skips it and relies on the cheap tier alone,
// so choosing "fast" actually is fast end-to-end instead of still paying
// ~1.5s for a wrap step that ignored the mode entirely (roughly half of fast
// mode's total time on real-world input before this change — see
// scripts/bench-zstd-feasibility.ts). This speedup applies even without
// zstd (gzip-only fast mode still skips brotli-11).
export const wrapSmallest = (pade: Uint8Array, mode: CompressionMode = "balanced"): Uint8Array => {
  const cheap = cheapTierCompress(pade)

  let best = pade
  if (cheap.length < best.length) best = cheap

  if (mode !== "fast") {
    const br = brotliCompressSync(pade, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_FILE_QUALITY } })
    if (br.length + 1 < best.length) {
      const wrapped = new Uint8Array(1 + br.length)
      wrapped[0] = BROTLI_MARKER
      wrapped.set(br, 1)
      best = wrapped
    }
  }
  return best
}

// Synchronous full pipeline: structural GF(2^8/16) encoding → smallest outer wrapper.
// Output may be raw .pade, zstd-wrapped, or brotli-wrapped — decompress() handles all three
// (plus legacy gzip-wrapped output from before this change). mode controls both the search
// budget: "fast" (fewer candidates, quicker) and now also the outer wrap: "fast" skips the
// expensive brotli-11 pass; "balanced" (default) / "max" try both zstd and brotli.
export const compress = (input: Uint8Array, mode: CompressionMode = "balanced"): Uint8Array =>
  wrapSmallest(serialize(encode(input, BUDGETS[mode])), mode)

// Decompresses output from compress() or compressAsync().
// Auto-detects zstd's frame magic (28 b5 2f fd), legacy gzip (1f 8b), and the
// brotli marker; falls back to raw PAD3/PAD4/PAD5.
export const decompress = (input: Uint8Array): Uint8Array => {
  let pade: Uint8Array
  if (input[0] === 0x28 && input[1] === 0xb5 && input[2] === 0x2f && input[3] === 0xfd) {
    if (!zstdDecompressSync) throw new Error("This file was zstd-compressed, which requires Node 22.15+ to decompress (this runtime lacks zlib.zstdDecompressSync).")
    pade = zstdDecompressSync(input)
  }
  else if (input[0] === 0x1f && input[1] === 0x8b) pade = gunzipSync(input)
  else if (input[0] === BROTLI_MARKER)             pade = brotliDecompressSync(input.subarray(1))
  else                                              pade = input
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
  wrapSmallest(serialize(await encodeAsync(input, workers, onProgress, BUDGETS[mode])), mode)

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
