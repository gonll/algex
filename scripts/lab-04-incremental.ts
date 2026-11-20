// Experimento 04 — beneficio incremental sobre Algex+wrapper en los PRBS ITU-T reales (archivos completos).
import * as fs from "fs"; import * as zlib from "zlib"
import { bytesToBits, bitsToBytes } from "../src/lab/bits"
import { synthLfsr2, genLfsr2, costLfsr2 } from "../src/lab/lfsr2"
import { compress, decompress } from "../src/index"
console.log("archivo    |  bytes | Algex (B) | Algex % | brotli11 | lab (B) | lab % | factor vs Algex | exacto | ms lab | ms Algex")
let sumA = 0, sumL = 0
for (const f of fs.readdirSync("test/real-data/prbs").sort()) {
  const d = new Uint8Array(fs.readFileSync("test/real-data/prbs/" + f))
  let t = performance.now(); const ax = compress(d); const msA = performance.now() - t
  const okA = Buffer.compare(Buffer.from(decompress(ax)), Buffer.from(d)) === 0
  const br = zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  t = performance.now()
  let best = Infinity, exact = false
  for (const msb of [true, false]) {
    const m = synthLfsr2(bytesToBits(d, msb), 4096)
    if (!m) continue
    const sz = Math.ceil(costLfsr2(m) / 8) + 1
    if (sz < best) { best = sz; exact = Buffer.compare(Buffer.from(bitsToBytes(genLfsr2(m), msb)), Buffer.from(d)) === 0 }
  }
  const msL = performance.now() - t
  sumA += ax.length; sumL += best
  console.log(`${f.padEnd(10)} | ${String(d.length).padStart(6)} | ${String(ax.length).padStart(9)} | ${(100*ax.length/d.length).toFixed(1).padStart(6)}% | ${String(br).padStart(8)} | ${String(best).padStart(7)} | ${(100*best/d.length).toFixed(3).padStart(5)}% | ${(ax.length/best).toFixed(0).padStart(14)}x | ${exact&&okA ? "✓" : "✗"}      | ${msL.toFixed(0).padStart(6)} | ${msA.toFixed(0)}`)
}
console.log(`TOTAL Algex ${sumA} B vs lab ${sumL} B`)
