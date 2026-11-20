// Experimento 07 — generadores de ACCESO DIRECTO f(n) vs generador secuencial (BM) vs brotli.
// Targets conocidos (en/fuera de la familia), controles negativos y ventanas reales de 4 KB.
//   npx tsx scripts/lab-07-fn-search.ts
import * as fs from "fs"; import * as zlib from "zlib"
import { searchExpr, exprToString, exprCostBits, Mode } from "../src/lab/expr-search"
import { synthLfsr2, costLfsr2 } from "../src/lab/lfsr2"
import { bitsToBytes, prng } from "../src/lab/bits"

const pc = (x: number) => { let c = 0; while (x) { c += x & 1; x >>>= 1 } return c }
const br = (d: Uint8Array) => zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const gen = (n: number, f: (i: number) => number, mask: number) => Uint8Array.from({ length: n }, (_, i) => f(i) & mask)
const imul = Math.imul

interface T { name: string; mode: Mode; data: Uint8Array; group: string }
const BYTES = 4096, BITS = 1 << 16
const rb = prng(1234)
const targets: T[] = [
  { group: "en familia", name: "(7n+3) mod 256", mode: "byte", data: gen(BYTES, i => i * 7 + 3, 255) },
  { group: "en familia", name: "n*n mod 256", mode: "byte", data: gen(BYTES, i => imul(i, i), 255) },
  { group: "en familia", name: "n xor (n>>3)", mode: "byte", data: gen(BYTES, i => i ^ (i >> 3), 255) },
  { group: "en familia", name: "(n*n) mod 251", mode: "byte", data: gen(BYTES, i => (i * i) % 251, 255) },
  { group: "fuera de familia", name: "(13n) xor (n>>2)  [13 fuera de la rejilla]", mode: "byte", data: gen(BYTES, i => (i * 13) ^ (i >> 2), 255) },
  { group: "en familia", name: "Thue–Morse  popcount(n)&1 [bits]", mode: "bit", data: gen(BITS, i => pc(i) & 1, 1) },
  { group: "en familia", name: "Rudin–Shapiro pc(n & n>>1)&1 [bits]", mode: "bit", data: gen(BITS, i => pc(i & (i >> 1)) & 1, 1) },
  { group: "en familia", name: "bit 3 de n*n [bits]", mode: "bit", data: gen(BITS, i => (imul(i, i) >>> 3) & 1, 1) },
  { group: "fuera de familia", name: "((40503n+12345)>>8) mod 256  (2 constantes grandes)", mode: "byte", data: gen(BYTES, i => (imul(i, 40503) + 12345) >>> 8, 255) },
  { group: "fuera de familia", name: "n^3 mod 997", mode: "byte", data: gen(BYTES, i => Number((BigInt(i) ** 3n) % 997n) & 255, 255) },
  { group: "fuera de familia", name: "Legendre mod 1009 (residuo cuadrático) [bits]", mode: "bit", data: gen(BITS, i => { const a = i % 1009; if (a === 0) return 0; let r = 1n, b = BigInt(a), e = 504n; while (e) { if (e & 1n) r = (r * b) % 1009n; b = (b * b) % 1009n; e >>= 1n } return r === 1n ? 1 : 0 }, 1) },
  { group: "control", name: "bytes aleatorios", mode: "byte", data: Uint8Array.from({ length: BYTES }, () => rb() & 255) },
  { group: "control", name: "bits aleatorios", mode: "bit", data: Uint8Array.from({ length: BITS }, () => rb() & 1) },
  { group: "control", name: "texto ASCII (README)", mode: "byte", data: new Uint8Array(fs.readFileSync("README.md").subarray(0, BYTES)) },
  { group: "control", name: "binario real (kernel8, 4 KB)", mode: "byte", data: new Uint8Array(fs.readFileSync("test/real-data/firmware/kernel8.img").subarray(1 << 20, (1 << 20) + BYTES)) },
]
console.log("grupo            | objetivo                                            | f(n) hallada                      | bits f(n) | BM bit L / bits  | brotli (bits) | nodos   | ms")
for (const t of targets) {
  const t0 = performance.now()
  const r = searchExpr(t.data, t.mode, { maxSize: 7, layerCap: 30000, budgetNodes: 500000 })
  const ms = performance.now() - t0
  let bm = "—"
  if (t.mode === "bit") { const m = synthLfsr2(t.data, 2048); bm = m ? `L=${m.L} / ${costLfsr2(m)}` : "no (L>2048)" }
  const packed = t.mode === "bit" ? bitsToBytes(t.data, true) : t.data
  console.log(`${t.group.padEnd(16)} | ${t.name.slice(0, 51).padEnd(51)} | ${(r ? exprToString(r.expr) : "— no encontrada —").slice(0, 33).padEnd(33)} | ${(r ? String(exprCostBits(r.expr)) : "—").padStart(9)} | ${bm.padEnd(16)} | ${String(br(packed) * 8).padStart(13)} | ${String(r?.explored ?? "").padStart(7)} | ${ms.toFixed(0)}`)
}
