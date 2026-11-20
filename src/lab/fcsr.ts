// Generador secuencial binario con acarreo: FCSR / expansión 2-ádica de una fracción p/q (q impar).
// Una fracción pequeña produce un período de hasta q-1 bits: es el análogo exacto de
// "una fracción pequeña genera miles de dígitos". Síntesis por reducción de retículo
// (equivalente al algoritmo de aproximación racional de Klapper–Goresky):
//   buscar (f,g), g impar, con f ≡ g·A (mod 2^n), minimizando |f|,|g|.
// Costo: gamma(n) + gamma(bits f) + gamma(bits g) + bits f + bits g + 2 signos.

import { bitLen, bitsToBigInt, bigIntToBits, gammaBits } from "./bits"

export interface Fcsr { n: number; f: bigint; g: bigint }

const abs = (x: bigint): bigint => (x < 0n ? -x : x)
const dot = (a: [bigint, bigint], b: [bigint, bigint]): bigint => a[0] * b[0] + a[1] * b[1]
const divRound = (a: bigint, b: bigint): bigint => {
  // round(a/b), b > 0
  const q = a / b, r = a - q * b
  if (2n * abs(r) >= b) return r >= 0n ? q + 1n : q - 1n
  return q
}

export const costFcsr = (m: Fcsr): number =>
  gammaBits(m.n) + gammaBits(bitLen(abs(m.f))) + gammaBits(bitLen(abs(m.g))) + bitLen(abs(m.f)) + bitLen(abs(m.g)) + 2

const modInv2 = (g: bigint, n: number): bigint => {
  // inverso de g (impar) módulo 2^n por Newton
  const mod = 1n << BigInt(n)
  const gm = ((g % mod) + mod) % mod
  let x = 1n, k = 1
  while (k < n) {
    k = Math.min(n, k * 2)
    const mk = 1n << BigInt(k)
    x = (x * (2n - ((gm * x) % mk))) % mk
    if (x < 0n) x += mk
  }
  return x
}

export const genFcsr = (m: Fcsr): Uint8Array => {
  const mod = 1n << BigInt(m.n)
  const a = ((((m.f % mod) + mod) % mod) * modInv2(m.g, m.n)) % mod
  return bigIntToBits(a, m.n)
}

export const synthFcsr = (bits: Uint8Array): Fcsr | null => {
  const n = bits.length
  if (n < 16) return null
  const A = bitsToBigInt(bits)
  let u: [bigint, bigint] = [1n << BigInt(n), 0n]
  let v: [bigint, bigint] = [A, 1n]
  // Reducción de Lagrange/Gauss del retículo {(f,g): f ≡ g·A mod 2^n}
  for (;;) {
    if (dot(v, v) < dot(u, u)) { const t = u; u = v; v = t }
    const mu = divRound(dot(u, v), dot(u, u))
    if (mu === 0n) break
    v = [v[0] - mu * u[0], v[1] - mu * u[1]]
  }
  const cands: Array<[bigint, bigint]> = [
    u, v, [u[0] + v[0], u[1] + v[1]], [u[0] - v[0], u[1] - v[1]],
  ]
  let best: Fcsr | null = null
  for (const [f, g] of cands) {
    if ((g & 1n) === 0n) continue
    const cand: Fcsr = { n, f, g }
    if (best === null || costFcsr(cand) < costFcsr(best)) best = cand
  }
  return best
}

/**
 * Síntesis progresiva: un modelo cuyo (f,g) ocupe b bits queda determinado por ~2b bits de
 * prefijo. Se sintetiza sobre prefijos de longitud doblada y se VERIFICA contra la secuencia
 * completa regenerándola. maxPrefix acota el trabajo (modelos de más de ~maxPrefix/2 bits
 * nunca serían rentables de todos modos para n razonables).
 */
export const synthFcsrProgressive = (bits: Uint8Array, maxPrefix = 1 << 13): Fcsr | null => {
  const n = bits.length
  for (let k = 128; ; k *= 2) {
    const kk = Math.min(k, n, maxPrefix)
    const m = synthFcsr(bits.subarray(0, kk))
    if (m) {
      const full: Fcsr = { n, f: m.f, g: m.g }
      const back = genFcsr(full)
      let ok = true
      for (let i = 0; i < n; i++) if (back[i] !== bits[i]) { ok = false; break }
      if (ok) return full
    }
    if (kk >= n || kk >= maxPrefix) return null
  }
}
