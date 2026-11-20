// Generadores OCULTOS de composiciones (exp. 10). Ningún módulo del buscador (compose.ts, ast.ts, probes.ts) importa este archivo.
// Parámetros aleatorios por instancia. Cada clase es capa(s) externa(s) ∘ interior (∘ índice).
// Convención: los índices solo usan los 16 bits bajos de n (el entrenamiento de 2^16 los observa todos).

import { prng } from "./bits"
import { Hidden, TABLE_MAX, makeHidden, makePoly, FamilyId } from "./hidden-gen"

const PAR = new Uint8Array(256); for (let i = 0; i < 256; i++) { let v = i, p = 0; while (v) { p ^= v & 1; v >>= 1 } PAR[i] = p }
type R = () => number
type Fn = (n: number) => number
type ByteMap = (x: number) => number

const rank8 = (rows: number[]): number => { const b: number[] = []; for (const v of rows) { let x = v; for (const e of b) x = Math.min(x, x ^ e); if (x) b.push(x) } return b.length }
const randAffine8 = (r: R): { f: ByteMap } => {
  let rows: number[]; do { rows = Array.from({ length: 8 }, () => r() & 255) } while (rank8(rows) < 8)
  const k = r() & 255
  return { f: (x) => { let o = 0; for (let i = 0; i < 8; i++) o |= (PAR[rows[i]! & x]! ^ ((k >> i) & 1)) << i; return o } }
}
const randBitPerm = (r: R): { f: ByteMap } => {
  const p = [0, 1, 2, 3, 4, 5, 6, 7]; for (let i = 7; i > 0; i--) { const j = r() % (i + 1); [p[i], p[j]] = [p[j]!, p[i]!] }
  return { f: (x) => { let o = 0; for (let i = 0; i < 8; i++) o |= ((x >> p[i]!) & 1) << i; return o } }
}
const wrap = (family: string, describe: string, table: Uint8Array): Hidden => ({ family, describe, eval: (n) => table[n]!, train: (N) => table.slice(0, N) })
const tab = (f: Fn): Uint8Array => { const t = new Uint8Array(TABLE_MAX); for (let i = 0; i < TABLE_MAX; i++) t[i] = f(i) & 255; return t }

const polyF = (r: R): Fn => makePoly(r).f
const beattyF = (r: R): Fn => { const a = r(), b = r(), s = r() % 13; return (n) => (((Math.imul(a, n) + b) >>> 0) >>> s) & 255 }
// byte obtenido de los 16 bits bajos de n: filas = máscaras (selección de bits, o combinaciones afines) + constante
const indexByte = (r: R, mode: "perm" | "affine"): Fn => {
  let rows: number[]
  if (mode === "perm") { const pos = Array.from({ length: 16 }, (_, i) => i); for (let i = 15; i > 0; i--) { const j = r() % (i + 1); [pos[i], pos[j]] = [pos[j]!, pos[i]!] } rows = pos.slice(0, 8).map((p) => 1 << p) }
  else rows = Array.from({ length: 8 }, () => (r() & 0xffff) | 1)
  const k = r() & 255
  const par16 = (v: number) => PAR[(v ^ (v >> 8)) & 255]!
  return (n) => { let o = 0; for (let i = 0; i < 8; i++) o |= (par16(rows[i]! & n & 0xffff) ^ ((k >> i) & 1)) << i; return o }
}
const polyOfByte = (r: R): ByteMap => { const c0 = r(), c1 = r(), c2 = r() | 1; return (x) => ((Math.imul(c2, Math.imul(x, x)) + Math.imul(c1, x) + c0) | 0) & 255 }

export const CLASSES = {
  // — lote A (desarrollo; los peelers se diseñaron mirando estas) —
  A1: "xorc∘poly", A2: "rotl∘poly", A3: "mulo∘beatty", A4: "xorc∘beatty", A5: "addc∘poly",
  // — lote B (ciego; composiciones no usadas para diseñar) —
  B1: "afín8∘poly", B2: "bitperm∘poly", B3: "poly∘selección-de-bits(n)", B4: "poly∘afín(n)",
  B5: "afín8∘beatty", B6: "rotl∘gf2", B7: "mulo∘poly", B8: "xorc∘afín8∘poly",
  B9: "afín8∘poly∘selección-de-bits(n)", B10: "xor(beatty,poly)", B11: "add(beatty,poly)", B12: "poly∘beatty",
  B13: "ANF∘selección-de-bits", B14: "prefijo-xor∘afín8∘poly",
  // — lote C (ciego nuevo; clases añadidas tras el diagnóstico de B11/B12) —
  C1: "xor(poly, gf2)", C2: "add(poly, gf2)",
  D1: "bitperm∘afín8∘poly (dos capas de bytes)", D3: "poly3∘selección-de-bits(n) (cúbico en el byte)",
} as const
export type ClassId = keyof typeof CLASSES
export const LOTE_A: ClassId[] = ["A1", "A2", "A3", "A4", "A5"]
export const LOTE_B: ClassId[] = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14"]

export const makeComposed = (cls: ClassId, seed: number): Hidden => {
  const r = prng(seed * 6007 + cls.charCodeAt(0) * 7919 + Number(cls.slice(1)) * 104729)
  const d = CLASSES[cls]
  switch (cls) {
    case "A1": { const p = polyF(r), k = 1 + (r() % 255); return wrap(cls, d, tab((n) => p(n) ^ k)) }
    case "A2": { const p = polyF(r), q = 1 + (r() % 7); return wrap(cls, d, tab((n) => { const v = p(n) & 255; return ((v << q) | (v >> (8 - q))) & 255 })) }
    case "A3": { const b = beattyF(r), m = (r() & 0x7f) * 2 + 3; return wrap(cls, d, tab((n) => (b(n) * m) & 255)) }
    case "A4": { const b = beattyF(r), k = 1 + (r() % 255); return wrap(cls, d, tab((n) => b(n) ^ k)) }
    case "A5": { const p = polyF(r), k = 1 + (r() % 255); return wrap(cls, d, tab((n) => (p(n) + k) & 255)) }
    case "B1": { const p = polyF(r), o = randAffine8(r); return wrap(cls, d, tab((n) => o.f(p(n) & 255))) }
    case "B2": { const p = polyF(r), o = randBitPerm(r); return wrap(cls, d, tab((n) => o.f(p(n) & 255))) }
    case "B3": { const u = indexByte(r, "perm"), P = polyOfByte(r); return wrap(cls, d, tab((n) => P(u(n)))) }
    case "B4": { const u = indexByte(r, "affine"), P = polyOfByte(r); return wrap(cls, d, tab((n) => P(u(n)))) }
    case "B5": { const b = beattyF(r), o = randAffine8(r); return wrap(cls, d, tab((n) => o.f(b(n)))) }
    case "B6": {
      const base = makeHidden("C", 500 + seed), q = 1 + (r() % 7)
      return wrap(cls, d, tab((n) => { const v = base.eval(n); return ((v << q) | (v >> (8 - q))) & 255 }))
    }
    case "B7": { const p = polyF(r), m = (r() & 0x7f) * 2 + 3; return wrap(cls, d, tab((n) => (p(n) * m) & 255)) }
    case "B8": { const p = polyF(r), o = randAffine8(r), k = 1 + (r() % 255); return wrap(cls, d, tab((n) => o.f(p(n) & 255) ^ k)) }
    case "B9": { const u = indexByte(r, "perm"), P = polyOfByte(r), o = randAffine8(r); return wrap(cls, d, tab((n) => o.f(P(u(n))))) }
    case "B10": { const b = beattyF(r), p = polyF(r); return wrap(cls, d, tab((n) => b(n) ^ p(n))) }
    case "B11": { const b = beattyF(r), p = polyF(r); return wrap(cls, d, tab((n) => b(n) + p(n))) }
    case "B12": { const b = beattyF(r), P = polyOfByte(r); return wrap(cls, d, tab((n) => P(b(n)))) }
    case "B13": {
      const base = makeHidden("D" as FamilyId, 700 + seed), u = indexByte(r, "perm")
      return wrap(cls, d, tab((n) => base.eval(u(n & 0xffff) | ((u((n & 0xffff) >> 3) & 255) << 8))))
    }
    case "B14": {
      const p = polyF(r), o = randAffine8(r), t = new Uint8Array(TABLE_MAX); let acc = 0
      for (let i = 0; i < TABLE_MAX; i++) { acc ^= o.f(p(i) & 255); t[i] = acc }
      return wrap(cls, d, t)
    }
    case "C1": { const p = polyF(r), l = makeHidden("C", 800 + seed); return wrap(cls, d, tab((n) => p(n) ^ l.eval(n))) }
    case "C2": { const p = polyF(r), l = makeHidden("C", 900 + seed); return wrap(cls, d, tab((n) => p(n) + l.eval(n))) }
    case "D1": { const p = polyF(r), o1 = randAffine8(r), o2 = randBitPerm(r); return wrap(cls, d, tab((n) => o2.f(o1.f(p(n) & 255)))) }
    case "D3": {
      const u = indexByte(r, "perm"), c0 = r(), c1 = r(), c2 = r(), c3 = r() | 1
      return wrap(cls, d, tab((n) => { const x = u(n), x2 = Math.imul(x, x), x3 = Math.imul(x2, x); return (Math.imul(c3, x3) + Math.imul(c2, x2) + Math.imul(c1, x) + c0) & 255 }))
    }
  }
}

/**
 * Rejilla controlada por j = s − v2(a) (ver §18): Beatty ⌊(a·n+b)/2^s⌋ con a = 2^t·impar, s = t + j.
 *   G11: add(beatty, poly)      G12: poly∘beatty (P de grado 2 aplicado al byte del Beatty)
 */
export type GridKind = "G11" | "G12"
export const makeGrid = (kind: GridKind, j: number, seed: number): Hidden => {
  const r = prng(seed * 9973 + j * 7919 + (kind === "G11" ? 11 : 12) * 104729)
  const t = r() % 3, a = Math.imul(r() | 1, 1 << t), b = r(), s = t + j
  const beat: Fn = (n) => (((Math.imul(a, n) + b) >>> 0) >>> s) & 255
  const d = `${kind} j=${j} (s=${s}, v2(a)=${t})`
  if (kind === "G11") { const p = polyF(r); return wrap(kind, d, tab((n) => beat(n) + p(n))) }
  const P = polyOfByte(r); return wrap(kind, d, tab((n) => P(beat(n))))
}
