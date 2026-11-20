// Diezmado como transformación general (laboratorio, exp. 12 parte 2). NO conoce los generadores ocultos.
//
// Un diezmado de módulo m parte y en m carriles  y_c(i) = y(m·i + c),  c = 0..m-1. Cada carrito se resuelve
// con el solver congelado (compose.ts) y luego se intenta COMPARTIR parámetros entre carriles:
// si todos los carriles tienen la misma forma (mismo árbol, mismos tamaños), cada campo numérico v_c (c = 0..m-1) se
// codifica como el más barato de:
//   const   : un valor
//   poly-c  : polinomio en c módulo 2^w (diferencias finitas hacia adelante; grado mínimo D)
//   gf2-c   : afín sobre GF(2) en los bits de c   v_c = u0 ^ XOR_{bit i de c} u_i
//   crudo   : m valores
// El costo es la suma real de bits de esa descripción (más cabecera y forma). La descripción es reversible:
// `rebuild` reconstruye cada carril y el test comprueba que evalúa igual.

import { Node, costBits } from "./ast"

export type Visit = (w: number, v: number) => number

/** Recorre los campos numéricos de un nodo en un orden fijo, devolviendo un nodo nuevo con cada valor v -> f(w, v). */
export const walk = (n: Node, f: Visit): Node => {
  switch (n.t) {
    case "poly": return { t: "poly", coef: n.coef.map((c) => f(8, c)) }
    case "gf2": { const c0 = f(8, n.c0); return { t: "gf2", K: n.K, c0, col: n.col.map((c) => f(8, c)) } }
    case "beatty": { const a = f(n.s + 8, n.a), b = f(n.s + 8, n.b); return { t: "beatty", a, b, s: n.s } }
    case "anf": return { t: "anf", K: n.K, monos: n.monos.map((l) => l.map((m) => f(n.K, m))) }
    case "table": return { t: "table", data: n.data.map((v) => f(8, v)) }
    case "xorc": case "addc": { const k = f(8, n.k); return { t: n.t, k, x: walk(n.x, f) } }
    case "mulo": { const q = f(7, (n.m - 1) >> 1); return { t: "mulo", m: q * 2 + 1, x: walk(n.x, f) } }
    case "rotl": { const r = f(3, n.r); return { t: "rotl", r, x: walk(n.x, f) } }
    case "baff": { const rows = n.rows.map((r) => f(8, r)); const k = f(8, n.k); return { t: "baff", rows, k, x: walk(n.x, f) } }
    case "prefix": return { t: "prefix", op: n.op, x: walk(n.x, f) }
    case "il2": { const a = walk(n.a, f); return { t: "il2", a, b: walk(n.b, f) } }
    case "bin": { const a = walk(n.a, f); return { t: "bin", op: n.op, a, b: walk(n.b, f) } }
    case "idx": { const rows = n.rows.map((r) => f(n.bits, r)); const k = f(n.rows.length, n.k); return { t: "idx", bits: n.bits, rows, k, x: walk(n.x, f) } }
  }
}
const fieldsOf = (n: Node): { w: number; v: number }[] => { const o: { w: number; v: number }[] = []; walk(n, (w, v) => { o.push({ w, v }); return v }); return o }
const signature = (n: Node): string => JSON.stringify(walk(n, () => 0))

export const laneLen = (N: number, m: number): number => 2 ** Math.floor(Math.log2(Math.floor(N / m)))
export const lane = (y: Uint8Array, m: number, c: number, L: number): Uint8Array => { const o = new Uint8Array(L); for (let i = 0; i < L; i++) o[i] = y[m * i + c]!; return o }
export const gammaBits = (v: number): number => 2 * Math.floor(Math.log2(v + 1)) + 1

// ── codificación de un vector v_0..v_{m-1} de campos de w bits ────────────────────────────────────
type Enc =
  | { kind: "const"; v: bigint }
  | { kind: "polyc"; d: bigint[] }          // Δ^t v(0), t = 0..D
  | { kind: "gf2c"; u: bigint[] }           // u0, u_1..u_nb
  | { kind: "raw"; v: bigint[] }
export interface FieldEnc { enc: Enc; bits: number }

const binom = (c: number, t: number): bigint => { let r = 1n; for (let i = 0; i < t; i++) r = (r * BigInt(c - i)) / BigInt(i + 1); return r }
const TAG = 2

export const encodeField = (vals: number[], w: number): FieldEnc => {
  const m = vals.length, M = 1n << BigInt(w), V = vals.map((v) => BigInt(v)), mod = (x: bigint) => ((x % M) + M) % M
  let best: FieldEnc = { enc: { kind: "raw", v: V }, bits: TAG + m * w }
  if (V.every((v) => v === V[0])) return { enc: { kind: "const", v: V[0]! }, bits: TAG + w }
  // polinomio en c
  let cur = V.slice(); const ds: bigint[] = []
  for (let t = 0; t < m; t++) {
    ds.push(cur[0]!)
    const next: bigint[] = []; for (let i = 0; i + 1 < cur.length; i++) next.push(mod(cur[i + 1]! - cur[i]!))
    if (next.every((x) => x === 0n)) { const bits = TAG + (t + 1) * w; if (bits < best.bits) best = { enc: { kind: "polyc", d: ds.slice() }, bits }; break }
    cur = next
  }
  // afín GF(2) en los bits de c
  const nb = Math.ceil(Math.log2(m)); let ok = true
  const u = [V[0]!]; for (let i = 0; i < nb; i++) u.push(V[1 << i]! ^ V[0]!)
  for (let c = 0; c < m && ok; c++) { let v = u[0]!; for (let i = 0; i < nb; i++) if ((c >> i) & 1) v ^= u[i + 1]!; if (v !== V[c]) ok = false }
  if (ok) { const bits = TAG + (1 + nb) * w; if (bits < best.bits) best = { enc: { kind: "gf2c", u }, bits } }
  return best
}
export const decodeField = (e: FieldEnc, c: number, w: number): number => {
  const M = 1n << BigInt(w), x = e.enc
  switch (x.kind) {
    case "const": return Number(x.v)
    case "raw": return Number(x.v[c]!)
    case "polyc": { let s = 0n; for (let t = 0; t < x.d.length; t++) s += binom(c, t) * x.d[t]!; return Number(((s % M) + M) % M) }
    case "gf2c": { let v = x.u[0]!; for (let i = 0; i + 1 < x.u.length; i++) if ((c >> i) & 1) v ^= x.u[i + 1]!; return Number(v) }
  }
}

export interface Shared {
  m: number
  shared: boolean                 // true: todos los carriles con la misma forma
  bits: number                    // costo total real de la descripción
  independentBits: number         // costo sin compartir (suma de carriles + cabecera)
  kinds: Record<string, number>   // cuántos campos usaron cada codificación
  rebuild: (c: number) => Node
}

/** Descripción compartida de m carriles (ya simplificados). */
export const shareLanes = (lanes: Node[]): Shared => {
  const m = lanes.length, header = gammaBits(m)
  const independentBits = header + lanes.reduce((s, n) => s + costBits(n), 0)
  const sig = signature(lanes[0]!)
  if (m === 1 || !lanes.every((n) => signature(n) === sig)) return { m, shared: false, bits: independentBits, independentBits, kinds: {}, rebuild: (c) => lanes[c]! }
  const F = lanes.map(fieldsOf), nf = F[0]!.length
  const encs: FieldEnc[] = [], kinds: Record<string, number> = {}
  let bits = header
  const valueBits = F[0]!.reduce((s, f) => s + f.w, 0)
  bits += costBits(lanes[0]!) - valueBits                               // forma: etiquetas, longitudes, tamaños
  for (let k = 0; k < nf; k++) { const e = encodeField(F.map((f) => f[k]!.v), F[0]![k]!.w); encs.push(e); bits += e.bits; kinds[e.enc.kind] = (kinds[e.enc.kind] ?? 0) + 1 }
  const tpl = lanes[0]!
  const rebuild = (c: number): Node => { let k = 0; return walk(tpl, (w) => decodeField(encs[k++]!, c, w)) }
  // +1 bit: indicador compartido/independiente (el codificador elige el más barato)
  return { m, shared: true, bits: Math.min(bits, independentBits) + 1, independentBits: independentBits + 1, kinds, rebuild }
}
