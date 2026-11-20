// Corpus reproducible del laboratorio. SINTÉTICO y REAL se reportan por separado.
import * as fs from "fs"
import * as path from "path"
import { prng, bitsToBytes } from "./bits"

const PRBS_TAPS: Record<number, number[]> = { 7: [7, 6], 15: [15, 14], 23: [23, 18], 31: [31, 28] }

export const genPrbsBits = (order: number, nBits: number): Uint8Array => {
  const taps = PRBS_TAPS[order]!
  let st = (1 << Math.min(order, 30)) | 1
  const out = new Uint8Array(nBits)
  for (let i = 0; i < nBits; i++) {
    let fb = 0
    for (const t of taps) fb ^= (st >>> (t - 1)) & 1
    out[i] = fb
    st = ((st << 1) | fb) & (order === 31 ? 0x7fffffff : (1 << order) - 1)
  }
  return out
}

const randOdd = (bitsN: number, r: () => number): bigint => {
  let x = 1n
  for (let i = 0; i < bitsN; i += 30) x = (x << 30n) | BigInt(r() & 0x3fffffff)
  return (x | (1n << BigInt(bitsN - 1)) | 1n) & ((1n << BigInt(bitsN)) - 1n)
}

export const genFcsrBits = (qBits: number, nBits: number, seed: number) => {
  const r = prng(seed)
  const g = randOdd(qBits, r)
  const f = randOdd(qBits - 1, r)
  const mod = 1n << BigInt(nBits)
  // a = f * g^{-1} mod 2^n
  let x = 1n, k = 1
  while (k < nBits) { k = Math.min(nBits, k * 2); const mk = 1n << BigInt(k); x = (x * (2n - ((g * x) % mk))) % mk; if (x < 0n) x += mk }
  const a = (f * x) % mod
  const bits = new Uint8Array(nBits)
  for (let i = 0; i < nBits; i++) bits[i] = Number((a >> BigInt(i)) & 1n)
  return { bits, f, g }
}

export const genDecimalDigits = (p: bigint, q: bigint, n: number): Uint8Array => {
  const s = (((p % q) * 10n ** BigInt(n)) / q).toString().padStart(n, "0")
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

export interface Item { name: string; group: "sintético" | "real" | "control"; data: Uint8Array }

export const buildCorpus = (): Item[] => {
  const out: Item[] = []
  const NB = 32 * 1024
  for (const o of [7, 15, 23, 31])
    out.push({ name: `PRBS${o} bit-serial MSB`, group: "sintético", data: bitsToBytes(genPrbsBits(o, NB * 8), true) })
  // LFSR de grado 64 con taps arbitrarios (Fibonacci, polinomio no necesariamente primitivo)
  {
    const r = prng(99), L = 64, c = Uint8Array.from({ length: L + 1 }, () => r() & 1); c[L] = 1
    const s = new Uint8Array(NB * 8)
    for (let i = 0; i < L; i++) s[i] = r() & 1
    for (let i = L; i < s.length; i++) { let v = 0; for (let j = 1; j <= L; j++) v ^= c[j]! & s[i - j]!; s[i] = v }
    out.push({ name: "LFSR grado 64 aleatorio", group: "sintético", data: bitsToBytes(s, true) })
  }
  // Mismo LFSR PRBS31 + ruido de bits (1 error cada ~1000 bits): BM exacto debe FALLAR
  {
    const b = genPrbsBits(31, NB * 8), r = prng(7)
    for (let i = 0; i < b.length; i++) if (r() % 1000 === 0) b[i]! ^= 1
    out.push({ name: "PRBS31 + 0.1% bits flipados", group: "sintético", data: bitsToBytes(b, true) })
  }
  for (const qb of [24, 64, 256]) {
    const { bits } = genFcsrBits(qb, NB * 8, 1000 + qb)
    out.push({ name: `FCSR p/q, q de ${qb} bits (2-ádico, LSB)`, group: "sintético", data: bitsToBytes(bits, false) })
  }
  out.push({ name: "decimales de 1/9973 (20 KB ASCII)", group: "sintético", data: genDecimalDigits(1n, 9973n, 20000) })
  out.push({ name: "decimales de 355/1000003 (20 KB ASCII)", group: "sintético", data: genDecimalDigits(355n, 1000003n, 20000) })
  {
    const r = prng(55), q = randOdd(120, r), p = randOdd(110, r)
    out.push({ name: "decimales de p/q con q de 120 bits (20 KB)", group: "sintético", data: genDecimalDigits(p, q, 20000) })
  }
  // Controles: no deben comprimirse con estos métodos
  {
    const r = prng(1234)
    out.push({ name: "aleatorio uniforme 32 KB", group: "control", data: Uint8Array.from({ length: NB }, () => r() & 255) })
    const d = new Uint8Array(20000); const r2 = prng(4321)
    for (let i = 0; i < d.length; i++) d[i] = 48 + (r2() % 10)
    out.push({ name: "dígitos decimales aleatorios 20 KB", group: "control", data: d })
  }
  // Reales (locales; se omiten si no existen)
  const readIf = (p: string, max: number): Uint8Array | null => {
    try { return new Uint8Array(fs.readFileSync(p).subarray(0, max)) } catch { return null }
  }
  const root = path.resolve(__dirname, "../..")
  const readme = readIf(path.join(root, "README.md"), NB)
  if (readme) out.push({ name: "texto real (README.md)", group: "real", data: readme })
  const exe = readIf(path.join(root, "c", "gf-analyze.exe"), NB)
  if (exe) out.push({ name: "binario real (gf-analyze.exe)", group: "real", data: exe })
  const node = readIf(process.execPath, NB)
  if (node) out.push({ name: "binario real (node, primeros 32 KB)", group: "real", data: node })
  return out
}
