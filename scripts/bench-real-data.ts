// Real-world measurements against genuinely public data (see
// test/real-data/MANIFEST.md for sources and licenses) — run this before
// pitching anything, per-file and aggregated, across every category the
// codec's target segments actually claim: real embedded firmware/kernel
// binaries, real network protocol captures, a real public-domain image
// (control case, outside the win zone), and real ITU-T PRBS test patterns.
//
// Run: npx tsx scripts/fetch-real-data.ts   (once, to populate test/real-data/)
//      npx tsx scripts/bench-real-data.ts

import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { gzipSync, brotliCompressSync, constants } from "zlib"
import * as zlibNs from "zlib"
import { compress, decompress } from "../src/index"

const zstdCompressSync = (zlibNs as any).zstdCompressSync as ((buf: Uint8Array, opts?: any) => Buffer) | undefined

type Row = { category: string; file: string; bytes: number; codec: number; codecMs: number; gzip: number; brotli9: number; brotli11: number; zstd: number | null }

const walk = (dir: string, category: string, rows: Row[]) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === "MANIFEST.md") continue
    if (statSync(p).isDirectory()) continue
    const buf = readFileSync(p)
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)

    const t0 = Date.now()
    const codecOut = compress(bytes)
    const codecMs = Date.now() - t0
    const ok = Buffer.compare(Buffer.from(decompress(codecOut)), Buffer.from(bytes)) === 0
    if (!ok) throw new Error(`ROUNDTRIP MISMATCH: ${p}`)

    const gzip = gzipSync(Buffer.from(bytes), { level: 9 }).length
    const brotli9 = brotliCompressSync(Buffer.from(bytes), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length
    const brotli11 = brotliCompressSync(Buffer.from(bytes), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
    const zstd = zstdCompressSync ? zstdCompressSync(bytes, { params: { 100: 19 } }).length : null

    rows.push({ category, file: name, bytes: bytes.length, codec: codecOut.length, codecMs, gzip, brotli9, brotli11, zstd })
  }
}

const rows: Row[] = []
const BASE = "test/real-data"
for (const category of ["firmware", "pcap", "image", "prbs"]) {
  walk(join(BASE, category), category, rows)
}

const pct = (n: number, of: number) => (n / of * 100).toFixed(1) + "%"
console.log("category  file                          bytes      codec (ratio)      gzip-9 (ratio)   brotli-11 (ratio)  zstd-19 (ratio)    codec_ms")
console.log("-".repeat(130))
for (const r of rows) {
  console.log(
    `${r.category.padEnd(9)} ${r.file.padEnd(29)} ${String(r.bytes).padStart(9)}  ` +
    `${String(r.codec).padStart(9)} (${pct(r.codec, r.bytes).padStart(6)})  ` +
    `${String(r.gzip).padStart(9)} (${pct(r.gzip, r.bytes).padStart(6)})  ` +
    `${String(r.brotli11).padStart(9)} (${pct(r.brotli11, r.bytes).padStart(6)})  ` +
    `${r.zstd === null ? "n/a".padStart(9) : String(r.zstd).padStart(9)} (${r.zstd === null ? "n/a" : pct(r.zstd, r.bytes).padStart(6)})  ` +
    `${String(r.codecMs).padStart(6)}`
  )
}

console.log("\n-- aggregated by category --")
for (const category of ["firmware", "pcap", "image", "prbs"]) {
  const rs = rows.filter(r => r.category === category)
  if (rs.length === 0) continue
  const sum = (f: (r: Row) => number) => rs.reduce((s, r) => s + f(r), 0)
  const totalBytes = sum(r => r.bytes)
  const totalCodec = sum(r => r.codec)
  const totalGzip = sum(r => r.gzip)
  const totalBrotli11 = sum(r => r.brotli11)
  console.log(`${category.padEnd(9)} total ${totalBytes} bytes -> codec ${pct(totalCodec, totalBytes)}  gzip-9 ${pct(totalGzip, totalBytes)}  brotli-11 ${pct(totalBrotli11, totalBytes)}`)
}
