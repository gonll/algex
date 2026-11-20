// Experimento 02 — LFSR binaria + ruido de bits: ¿hasta qué tasa de error sigue siendo rentable
// "modelo + residual" frente a brotli/zstd/Algex? Barrido de tasas, 3 repeticiones por punto.
//   npx tsx scripts/lab-02-noisy-lfsr.ts
import * as zlib from "zlib"
import { genPrbsBits } from "../src/lab/corpus"
import { prng, bitsToBytes } from "../src/lab/bits"
import { synthNoisyLfsr2, genNoisyLfsr2, costNoisyLfsr2 } from "../src/lab/lfsr2-noisy"
import { compress } from "../src/index"

const N = 32 * 1024 * 8
const rates = [0, 0.0001, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2]
console.log("PRBS31, n = 262144 bits (32 KiB). Entropía del residual H(p)·n/8 = cota inferior de bytes de corrección.\n")
console.log("tasa   | modelo+resid (B) | exacto | cota H(p) (B) | brotli11 | zstd19 | Algex  | ms")
for (const p of rates) {
  const rows: string[] = []
  for (let rep = 0; rep < 2; rep++) {
    const b = genPrbsBits(31, N), r = prng(100 + rep)
    const thr = Math.floor(p * 2 ** 32)
    for (let i = 0; i < N; i++) if (r() < thr) b[i]! ^= 1
    const d = bitsToBytes(b, true)
    const t0 = performance.now()
    const m = synthNoisyLfsr2(b, 4096)
    const ms = performance.now() - t0
    const exact = m ? Buffer.compare(Buffer.from(genNoisyLfsr2(m)), Buffer.from(b)) === 0 : false
    const bytes = m ? Math.ceil(costNoisyLfsr2(m) / 8) + 1 : NaN
    const H = p === 0 ? 0 : (-(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)) * N) / 8
    const br = zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
    const zs = (zlib as any).zstdCompressSync(d, { params: { [(zlib as any).constants.ZSTD_c_compressionLevel]: 19 } }).length
    const ax = compress(d).length
    rows.push(`${(p * 100).toFixed(2).padStart(5)}% | ${String(bytes).padStart(16)} | ${exact ? "  ✓   " : m ? " ✗✗✗  " : "  —   "} | ${H.toFixed(0).padStart(13)} | ${String(br).padStart(8)} | ${String(zs).padStart(6)} | ${String(ax).padStart(6)} | ${ms.toFixed(0)}`)
    if (m && !exact) process.exitCode = 1
  }
  console.log(rows.join("\n"))
}
