// Full comparison on real data: the codec across all three modes vs plain
// gzip/brotli/zstd, on the real-world corpus (real ITU-T PRBS7/15/23/31 +
// real compiled binaries — see gen-real-world-file.ts). Reflects this
// session's zstd/fast-mode wiring in src/index.ts.

import { readFileSync } from "fs"
import { gzipSync, brotliCompressSync, constants } from "zlib"
import * as zlib from "zlib"
import { compress, decompress } from "../src/index"

const zstdCompressSync = (zlib as any).zstdCompressSync as ((buf: Uint8Array, opts?: any) => Buffer) | undefined

const real = readFileSync("test/real-world.bin")
const bytes = new Uint8Array(real.buffer, real.byteOffset, real.byteLength)
const pct = (n: number) => (n / bytes.length * 100).toFixed(1) + "%"

console.log(`input: ${bytes.length} bytes (real ITU-T PRBS7/15/23/31 + real compiled binaries)\n`)

console.log("-- codec, all modes --")
for (const mode of ["fast", "balanced", "max"] as const) {
  const t0 = Date.now()
  const out = compress(bytes, mode)
  const ms = Date.now() - t0
  const ok = Buffer.compare(Buffer.from(decompress(out)), Buffer.from(bytes)) === 0
  const wrapper = out[0] === 0x28 ? "zstd" : out[0] === 0xb2 ? "brotli" : out[0] === 0x1f ? "gzip" : "raw"
  console.log(`${mode.padEnd(10)} ${out.length} bytes (${pct(out.length)})  ${ms}ms  wrapper=${wrapper}  roundtrip=${ok ? "OK" : "MISMATCH"}`)
}

console.log("\n-- plain compressors on the raw input, for reference --")
{
  const t0 = Date.now(); const gz = gzipSync(bytes, { level: 9 })
  console.log(`gzip-9     ${gz.length} bytes (${pct(gz.length)})  ${Date.now() - t0}ms`)
}
{
  const t0 = Date.now(); const br9 = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
  console.log(`brotli-9   ${br9.length} bytes (${pct(br9.length)})  ${Date.now() - t0}ms`)
}
{
  const t0 = Date.now(); const br11 = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
  console.log(`brotli-11  ${br11.length} bytes (${pct(br11.length)})  ${Date.now() - t0}ms`)
}
if (zstdCompressSync) {
  const t0 = Date.now(); const zs = zstdCompressSync(bytes, { params: { 100: 19 } })
  console.log(`zstd-19    ${zs.length} bytes (${pct(zs.length)})  ${Date.now() - t0}ms`)
} else {
  console.log("zstd       (not available on this Node runtime)")
}
