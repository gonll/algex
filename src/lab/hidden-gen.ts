// Generadores OCULTOS para el experimento de descubrimiento ciego (scripts/lab-09-blind-discovery.ts).
//
// REGLA DE SEPARACIÓN: ningún módulo del buscador (synth.ts, expr-search.ts) puede importar este
// archivo; un test lo verifica. El buscador solo ve el Uint8Array de entrenamiento.
//
// Cada familia usa parámetros aleatorios (constantes de 32 bits, desplazamientos, máscaras), de modo
// que ninguna instancia pertenece a un catálogo ni a una rejilla de constantes del buscador.

import { prng } from "./bits"

export interface Hidden {
  readonly family: string
  readonly describe: string
  eval(n: number): number                 // byte en el índice n (0 <= n < TABLE_MAX)
  train(N: number): Uint8Array            // los primeros N bytes
}

export const TABLE_MAX = (1 << 20) + 80000

export const FAMILIES = {
  // — diseñadas para ser descubribles por una síntesis guiada por propiedades —
  A: "afín desplazada: ((a·n+b) mod 2^32 >> s) & 255",
  B: "polinomio grado 2–3 mod 2^32, byte bajo",
  C: "mezcla lineal GF(2) (xorshift) de n, byte bajo",
  D: "booleana cuadrática sobre los 16 bits de n",
  E: "XOR acumulado (prefijo) de una mezcla lineal",
  G: "entrelazado: pares = polinomio, impares = xorshift",
  // — esperadas como FALLO (controles y fronteras) —
  F: "suma acumulada de una afín desplazada",
  X1: "xorshift de bytes aplicado a un polinomio",
  X2: "polinomio evaluado sobre un xorshift de n",
  H: "hash fmix32(n), byte bajo",
  T: "LCG truncado (byte alto del estado)",
  R: "bytes aleatorios",
} as const
export type FamilyId = keyof typeof FAMILIES

type Fn = (n: number) => number

const tableOf = (f: Fn, prefix?: (acc: number, v: number) => number): Uint8Array => {
  const t = new Uint8Array(TABLE_MAX)
  let acc = 0
  for (let i = 0; i < TABLE_MAX; i++) { const v = f(i) & 255; if (prefix) { acc = prefix(acc, v); t[i] = acc } else t[i] = v }
  return t
}
const wrap = (family: FamilyId, describe: string, f: Fn, table?: Uint8Array): Hidden => {
  const t = table
  return {
    family, describe,
    eval: (n) => (t ? t[n]! : f(n) & 255),
    train: (N) => { const o = new Uint8Array(N); for (let i = 0; i < N; i++) o[i] = t ? t[i]! : f(i) & 255; return o },
  }
}

export const makeAffineShifted = (r: () => number): { f: Fn; d: string } => {
  const a = r(), b = r(), s = r() % 25
  return { f: (n) => (((Math.imul(a, n) + b) >>> 0) >>> s) & 255, d: `((${a}*n+${b})>>>${s})&255` }
}
export const makePoly = (r: () => number): { f: Fn; d: string } => {
  const deg = 2 + (r() & 1), c0 = r(), c1 = r(), c2 = r(), c3 = r() | 1
  return {
    f: (n) => { const n2 = Math.imul(n, n), n3 = Math.imul(n2, n); let v = (Math.imul(c1, n) + c0) | 0; v = (v + Math.imul(c2 | (deg === 2 ? 1 : 0), n2)) | 0; if (deg === 3) v = (v + Math.imul(c3, n3)) | 0; return v & 255 },
    d: `poly deg ${deg}`,
  }
}
// mezcla lineal/afín sobre GF(2) de la palabra de 32 bits n; exactamente un desplazamiento a la derecha (<= 8)
export const makeLinFull = (r: () => number): { f: Fn; d: string } => {
  const count = 2 + (r() % 3)
  const steps: Array<[string, number]> = []
  const rightAt = r() % count
  for (let i = 0; i < count; i++) {
    if (i === rightAt) steps.push(["R", 1 + (r() % 8)])
    else steps.push(r() % 3 === 0 ? ["K", 1 + (r() % 255)] : ["L", 1 + (r() % 7)])
  }
  return {
    f: (n) => { let x = n >>> 0; for (const [t, p] of steps) { if (t === "L") x = (x ^ (x << p)) >>> 0; else if (t === "R") x = (x ^ (x >>> p)) >>> 0; else x = (x ^ p) >>> 0 } return x },
    d: steps.map(([t, p]) => t + p).join(","),
  }
}
const parity = (x: number): number => { x ^= x >>> 16; x ^= x >>> 8; x ^= x >>> 4; x ^= x >>> 2; x ^= x >>> 1; return x & 1 }

export const makeHidden = (family: FamilyId, seed: number): Hidden => {
  const r = prng(seed * 7919 + family.charCodeAt(0) * 104729 + (family.length > 1 ? family.charCodeAt(1) : 0))
  switch (family) {
    case "A": { const { f, d } = makeAffineShifted(r); return wrap("A", d, f) }
    case "B": { const { f, d } = makePoly(r); return wrap("B", d, f) }
    case "C": { const { f, d } = makeLinFull(r); return wrap("C", d, (n) => f(n) & 255) }
    case "D": {
      const lin: number[] = [], quad: Array<Array<[number, number]>> = [], cst: number[] = []
      for (let j = 0; j < 8; j++) {
        let m = 0; const nl = 2 + (r() % 3); for (let q = 0; q < nl; q++) m |= 1 << (r() % 16)
        lin.push(m); cst.push(r() & 1)
        const pairs: Array<[number, number]> = []; const np = 1 + (r() % 3)
        for (let q = 0; q < np; q++) { const i = r() % 16; let k = r() % 16; if (k === i) k = (k + 1) % 16; pairs.push([i, k]) }
        quad.push(pairs)
      }
      const f: Fn = (n) => { let o = 0; for (let j = 0; j < 8; j++) { let b = parity(n & lin[j]!) ^ cst[j]!; for (const [i, k] of quad[j]!) b ^= ((n >>> i) & (n >>> k)) & 1; o |= b << j } return o }
      return wrap("D", "ANF cuadrática 16 bits", f)
    }
    case "E": { const { f, d } = makeLinFull(r); return wrap("E", "prefijo-XOR de " + d, (n) => f(n) & 255, tableOf((n) => f(n) & 255, (a, v) => a ^ v)) }
    case "G": {
      const p = makePoly(r), l = makeLinFull(r)
      return wrap("G", "pares: " + p.d + " | impares: " + l.d, (n) => ((n & 1) ? l.f(n >>> 1) & 255 : p.f(n >>> 1) & 255))
    }
    case "F": { const { f, d } = makeAffineShifted(r); return wrap("F", "suma acumulada de " + d, f, tableOf(f, (a, v) => (a + v) & 255)) }
    case "X1": {
      const p = makePoly(r), a = 1 + (r() % 7), b = 1 + (r() % 7), k = 1 + (r() % 255)
      return wrap("X1", "byteLin∘poly", (n) => { let x = p.f(n) & 255; x = (x ^ (x << a)) & 255; x = x ^ (x >>> b); return (x ^ k) & 255 })
    }
    case "X2": {
      const p = makePoly(r), l = makeLinFull(r)
      const c0 = r(), c1 = r(), c2 = r() | 1
      void p
      return wrap("X2", "poly∘xorshift", (n) => { const x = l.f(n); const x2 = Math.imul(x, x); return ((Math.imul(c2, x2) + Math.imul(c1, x) + c0) | 0) & 255 })
    }
    case "H": return wrap("H", "fmix32", (n) => { let h = n >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h & 255 })
    case "T": {
      const a = r() | 1, c = r() | 1; let s = r()
      const t = new Uint8Array(TABLE_MAX)
      for (let i = 0; i < TABLE_MAX; i++) { t[i] = s >>> 24; s = (Math.imul(a, s) + c) >>> 0 }
      return wrap("T", "LCG truncado", () => 0, t)
    }
    default: { const t = new Uint8Array(TABLE_MAX); for (let i = 0; i < TABLE_MAX; i++) t[i] = r() & 255; return wrap("R", "aleatorio", () => 0, t) }
  }
}
