// Experimento 01 — búsqueda inversa de generadores binarios y numéricos.
// Compara, por entrada: LFSR/GF(2), FCSR 2-ádico, racional decimal, y los baselines
// (Algex actual, gzip-9, brotli-11, zstd-19). Verifica reconstrucción exacta de cada método.
//   npx tsx scripts/lab-01-inverse.ts
import * as zlib from "zlib"
import { buildCorpus } from "../src/lab/corpus"
import { bytesToBits, bitsToBytes } from "../src/lab/bits"
import { synthLfsr2, genLfsr2, costLfsr2 } from "../src/lab/lfsr2"
import { synthFcsrProgressive, genFcsr, costFcsr } from "../src/lab/fcsr"
import { synthDecRatProgressive, genDecRat, costDecRat } from "../src/lab/decimal-rational"
import { compress, decompress } from "../src/index"

const MAXL = 4096
const t = <T>(f: () => T): [T, number] => { const s = performance.now(); const r = f(); return [r, performance.now() - s] }
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(a, b) === 0

interface Res { bytes: number; ms: number; exact: boolean; note: string }

// Cada método devuelve el mejor intento (menor costo) sobre las variantes de orden de bits.
const mBM = (d: Uint8Array): Res | null => {
  let best: Res | null = null
  const t0 = performance.now()
  for (const msb of [true, false]) {
    const bits = bytesToBits(d, msb)
    const m = synthLfsr2(bits, MAXL)
    if (!m) continue
    const exact = eq(bitsToBytes(genLfsr2(m), msb), d)
    const bytes = Math.ceil(costLfsr2(m) / 8) + 1
    if (!best || bytes < best.bytes) best = { bytes, ms: 0, exact, note: `L=${m.L} ${msb ? "MSB" : "LSB"}` }
  }
  if (best) best.ms = performance.now() - t0
  return best
}
const mFCSR = (d: Uint8Array): Res | null => {
  let best: Res | null = null
  const t0 = performance.now()
  for (const msb of [false, true]) {
    const bits = bytesToBits(d, msb)
    const m = synthFcsrProgressive(bits)
    if (!m) continue
    const exact = eq(bitsToBytes(genFcsr(m), msb), d)
    const bytes = Math.ceil(costFcsr(m) / 8) + 1
    if (!best || bytes < best.bytes) best = { bytes, ms: 0, exact, note: `${msb ? "MSB" : "LSB"}` }
  }
  if (best) best.ms = performance.now() - t0
  return best
}
const mDec = (d: Uint8Array): Res | null => {
  const [m, ms] = t(() => synthDecRatProgressive(d))
  if (!m) return null
  return { bytes: Math.ceil(costDecRat(m) / 8) + 1, ms, exact: eq(genDecRat(m), d), note: `q=${m.q.toString().slice(0, 12)}${m.q.toString().length > 12 ? "…" : ""}` }
}

const base = (d: Uint8Array) => {
  const [gz] = t(() => zlib.gzipSync(d, { level: 9 }).length)
  const [br] = t(() => zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: d.length } }).length)
  const zs = (zlib as any).zstdCompressSync
    ? (zlib as any).zstdCompressSync(d, { params: { [(zlib as any).constants.ZSTD_c_compressionLevel]: 19 } }).length : NaN
  const [ax, axMs] = t(() => compress(d))
  const axOk = eq(decompress(ax), d)
  return { gz, br, zs, ax: ax.length, axMs, axOk }
}

const fmt = (r: Res | null, n: number) => r ? `${String(r.bytes).padStart(7)} ${(100 * r.bytes / n).toFixed(2).padStart(7)}% ${r.exact ? "✓" : "✗ INEXACTO"}` : "      —        —  "

const rows: string[] = []
console.log("grupo      | entrada                                   |     n | LFSR/GF(2)         | FCSR 2-ádico       | racional decimal   | Algex actual      | brotli11 | zstd19 | gzip9")
for (const it of buildCorpus()) {
  const d = it.data, n = d.length
  const a = mBM(d), b = mFCSR(d), c = mDec(d), bs = base(d)
  const line = `${it.group.padEnd(10)} | ${it.name.padEnd(42)}| ${String(n).padStart(5)} | ${fmt(a, n)} | ${fmt(b, n)} | ${fmt(c, n)} | ${String(bs.ax).padStart(7)} ${(100 * bs.ax / n).toFixed(1).padStart(5)}%${bs.axOk ? "" : "✗"} | ${String(bs.br).padStart(8)} | ${String(bs.zs).padStart(6)} | ${bs.gz}`
  console.log(line)
  const best = [a, b, c].filter((x): x is Res => !!x && x.exact)
  const notes = [a && `BM:${a.note} ${a.ms.toFixed(0)}ms`, b && `FCSR:${b.note} ${b.ms.toFixed(0)}ms`, c && `DEC:${c.note} ${c.ms.toFixed(0)}ms`].filter(Boolean).join(" | ")
  rows.push(`   ↳ ${notes}  | Algex ${bs.axMs.toFixed(0)}ms`)
  console.log(rows[rows.length - 1])
  if ([a, b, c].some((x) => x && !x.exact)) { console.error("!! RECONSTRUCCIÓN INEXACTA"); process.exitCode = 1 }
  void best
}
