// Roadmap 3 candidate #2: Zstandard as a 4th competitor in wrapSmallest /
// bestWireFor, alongside raw/gzip/brotli.
//
// Node 22.15+ ships real libzstd bindings in the built-in `zlib` module
// (zstdCompressSync/zstdDecompressSync) -- no new dependency needed at all,
// unlike what was assumed when this idea was first ranked. This tests
// whether it's actually worth adding: ratio AND decompression speed, since
// nothing in this project has measured decompression speed on the
// non-algebraic fallback path before.

import { readFileSync } from "fs"
import { gzipSync, brotliCompressSync, brotliDecompressSync, zstdCompressSync, zstdDecompressSync, constants } from "zlib"
import { compress as codecCompress, decompress as codecDecompress } from "../src/index"

const time = <T,>(fn: () => T): [T, number] => {
  const t0 = Date.now()
  const r = fn()
  return [r, Date.now() - t0]
}

const zstdAt = (buf: Uint8Array, level: number) =>
  zstdCompressSync(Buffer.from(buf), { params: { [constants.ZSTD_c_compressionLevel]: level } })

const report = (label: string, buf: Uint8Array) => {
  console.log(`\n=== ${label} (${buf.length} bytes) ===`)

  const [gz, gzT] = time(() => gzipSync(Buffer.from(buf), { level: 9 }))
  const [br9, br9T] = time(() => brotliCompressSync(Buffer.from(buf), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }))
  const [br11, br11T] = time(() => brotliCompressSync(Buffer.from(buf), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }))
  const [zs19, zs19T] = time(() => zstdAt(buf, 19))
  const [zs22, zs22T] = time(() => zstdAt(buf, 22))

  const [, br11DecT] = time(() => brotliDecompressSync(br11))
  const [, zs22DecT] = time(() => zstdDecompressSync(zs22))

  const pct = (n: number) => (n / buf.length * 100).toFixed(2) + "%"
  console.log(`gzip-9:      ${gz.length} B  (${pct(gz.length)})   enc ${gzT}ms`)
  console.log(`brotli-9:    ${br9.length} B  (${pct(br9.length)})   enc ${br9T}ms`)
  console.log(`brotli-11:   ${br11.length} B  (${pct(br11.length)})   enc ${br11T}ms  dec ${br11DecT}ms`)
  console.log(`zstd-19:     ${zs19.length} B  (${pct(zs19.length)})   enc ${zs19T}ms`)
  console.log(`zstd-22:     ${zs22.length} B  (${pct(zs22.length)})   enc ${zs22T}ms  dec ${zs22DecT}ms`)
  console.log(`brotli-11 vs zstd-22: ${br11.length < zs22.length ? "brotli-11 smaller" : "zstd-22 smaller"} by ${Math.abs(br11.length - zs22.length)} B` +
    `,  decompress speedup (zstd/brotli): ${(br11DecT / Math.max(1, zs22DecT)).toFixed(1)}x`)
}

const real = readFileSync("test/real-world.bin")
const realBytes = new Uint8Array(real.buffer, real.byteOffset, real.byteLength)
report("real compiled binaries only", realBytes.subarray(256 * 1024))
report("real PRBS7/15/23/31 only", realBytes.subarray(0, 256 * 1024))
report("full real-world corpus", realBytes)

// Full codec compress()+decompress() vs a hypothetical codec-output-then-zstd
// pass, to see if zstd would help the CODEC'S OWN structural output the way
// it might help the raw fallback content above.
console.log(`\n=== codec's own serialized output, before the outer wrap ===`)
const codecOut = codecCompress(realBytes)
console.log(`current compress() output: ${codecOut.length} bytes`)
