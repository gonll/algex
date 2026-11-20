// Experimento 06 — cierre de PAD6: ruido, grado de LFSR 32–96 y archivos mixtos, todo por el encoder real.
// Se compara serialize(encode()) con el candidato activado/apagado (misma etapa, sin wrapper), compress() completo y brotli-11.
//   npx tsx scripts/lab-06-pad6-close.ts
import * as fs from "fs"; import * as zlib from "zlib"
import { encode } from "../src/codec/encoder"
import { serialize, deserialize } from "../src/codec/format"
import { decode } from "../src/codec/decoder"
import { DEFAULT_BUDGET } from "../src/codec/search-budget"
import { compress, decompress } from "../src/index"
import { genPrbsBits } from "../src/lab/corpus"
import { bitsToBytes, prng } from "../src/lab/bits"

const KB = 1024
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(a, b) === 0
const br = (d: Uint8Array) => zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const concat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length } return o }

const measure = (d: Uint8Array) => {
  const t0 = performance.now(); const on = encode(d, DEFAULT_BUDGET); const msOn = performance.now() - t0
  const wOn = serialize(on)
  const wOff = serialize(encode(d, { ...DEFAULT_BUDGET, enableBitLfsr: false }))
  const full = compress(d)
  const ok = eq(decode(deserialize(wOn)), d) && eq(decompress(full), d)
  const nb = on.chunks.filter(c => c.kind === "bit-lfsr").length
  return { on: wOn.length, off: wOff.length, full: full.length, br: br(d), ok, nb, n: on.chunks.length, msOn }
}
const row = (label: string, d: Uint8Array, extra = "") => {
  const m = measure(d)
  console.log(`${label.padEnd(34)} | ${String(d.length).padStart(7)} | ${String(m.on).padStart(7)} | ${String(m.full).padStart(7)} | ${String(m.off).padStart(7)} | ${String(m.br).padStart(7)} | ${m.nb}/${m.n}`.padEnd(100) + ` | ${m.ok ? "✓" : "✗ INEXACTO"} ${extra}`)
  if (!m.ok) process.exitCode = 1
}
const header = () => console.log("caso".padEnd(34) + " |       n | enc ON  | compress| enc OFF | brotli  | bitLFSR chunks | exacto")

const randLfsrBits = (L: number, nBits: number, seed: number) => {
  const r = prng(seed), c = Uint8Array.from({ length: L + 1 }, () => r() & 1); c[L] = 1
  const s = new Uint8Array(nBits); for (let i = 0; i < L; i++) s[i] = r() & 1
  if (s.slice(0, L).every(v => v === 0)) s[0] = 1
  for (let i = L; i < nBits; i++) { let v = 0; for (let j = 1; j <= L; j++) v ^= c[j]! & s[i - j]!; s[i] = v }
  return s
}
const flip = (bits: Uint8Array, p: number, seed: number) => { const r = prng(seed), thr = Math.floor(p * 2 ** 32); for (let i = 0; i < bits.length; i++) if (r() < thr) bits[i]! ^= 1; return bits }

console.log("\n== A) PRBS31 128 KiB + ruido de bits (por el encoder real; cota Shannon H(p)·n/8) ==")
header()
for (const p of [0, 0.001, 0.005, 0.01, 0.02, 0.03, 0.05]) {
  const n = 128 * KB * 8, b = flip(genPrbsBits(31, n), p, 11)
  const H = p === 0 ? 0 : (-(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)) * n) / 8
  row(`PRBS31 ruido ${(p * 100).toFixed(1)}%`, bitsToBytes(b, true), `cota ${H.toFixed(0)}B`)
}

console.log("\n== B) LFSR aleatorio denso, grado L (128 KiB, exacto) — límite de puerta: L<=64 ==")
header()
for (const L of [32, 40, 48, 64, 72, 96]) row(`LFSR L=${L}`, bitsToBytes(randLfsrBits(L, 128 * KB * 8, 100 + L), true))
console.log("-- con ruido 0.5% --")
for (const L of [32, 48]) row(`LFSR L=${L} + 0.5% ruido`, bitsToBytes(flip(randLfsrBits(L, 128 * KB * 8, 200 + L), 0.005, 5), true))

console.log("\n== C) Archivo mixto: PRBS31 | firmware | PRBS23+0.5% | texto | LFSR48 | firmware | PRBS31 (mismo polinomio) ==")
header()
{
  const rd = (f: string, off: number, n: number) => new Uint8Array(fs.readFileSync(f).subarray(off, off + n))
  const parts = [
    bitsToBytes(genPrbsBits(31, 32 * KB * 8), true),
    rd("test/real-data/firmware/kernel8.img", 2 << 20, 32 * KB),
    bitsToBytes(flip(genPrbsBits(23, 32 * KB * 8), 0.005, 3), true),
    rd("README.md", 0, 16 * KB),
    bitsToBytes(randLfsrBits(48, 32 * KB * 8, 77), true),
    rd("test/real-data/firmware/start.elf", 1 << 20, 32 * KB),
    bitsToBytes(genPrbsBits(31, 32 * KB * 8), true),
  ]
  row("mixto (7 segmentos)", concat(...parts))
  row("sólo los 3 segmentos de datos reales", concat(parts[1]!, parts[3]!, parts[5]!))
}
