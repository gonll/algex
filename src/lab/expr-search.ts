// Generador de ACCESO DIRECTO: f(n) -> byte/bit, buscado por enumeración ascendente de expresiones
// con equivalencia observacional (dedupe por firma sobre P puntos) y constantes libres.
//
// Semántica reproducible entre plataformas: enteros de 32 bits sin signo (Math.imul / >>> 0);
// "%" es el módulo sin signo por una constante > 0; ">>" y "<<" por constante 1..31; pc = popcount.
// Costo (modelo, NO serializado): 4 bits por nodo + gamma(constante). No incluye el intérprete
// del DSL (costo de decoder fijo, no amortizado por archivo) — se reporta aparte en los experimentos.

import { gammaBits } from "./bits"

export type Op = "n" | "c" | "+" | "-" | "*" | "^" | "&" | "|" | "<<" | ">>" | "%" | "pc" | "pm"
// pm: (a ** e) mod k  (potencia modular: aritmética de módulo < 2^16, exacta en doubles)
export interface Expr { op: Op; a?: Expr; b?: Expr; k?: number; e?: number }

const pc32 = (x: number): number => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) }

const powMod = (b: number, e: number, m: number): number => {
  let r = 1, x = b % m
  while (e > 0) { if (e & 1) r = (r * x) % m; x = (x * x) % m; e = Math.floor(e / 2) }
  return r
}

export const evalExpr = (e: Expr, n: number): number => {
  switch (e.op) {
    case "pm": return powMod(evalExpr(e.a!, n) >>> 0, e.e!, e.k!)
    case "n": return n >>> 0
    case "c": return e.k! >>> 0
    case "pc": return pc32(evalExpr(e.a!, n))
    case "<<": return (evalExpr(e.a!, n) << e.k!) >>> 0
    case ">>": return evalExpr(e.a!, n) >>> e.k!
    case "%": return (evalExpr(e.a!, n) >>> 0) % (e.k! >>> 0)
    case "+": return (evalExpr(e.a!, n) + evalExpr(e.b!, n)) >>> 0
    case "-": return (evalExpr(e.a!, n) - evalExpr(e.b!, n)) >>> 0
    case "*": return Math.imul(evalExpr(e.a!, n), evalExpr(e.b!, n)) >>> 0
    case "^": return (evalExpr(e.a!, n) ^ evalExpr(e.b!, n)) >>> 0
    case "&": return (evalExpr(e.a!, n) & evalExpr(e.b!, n)) >>> 0
    default:  return (evalExpr(e.a!, n) | evalExpr(e.b!, n)) >>> 0
  }
}

export const exprToString = (e: Expr): string => {
  switch (e.op) {
    case "n": return "n"
    case "c": return String(e.k)
    case "pc": return `pc(${exprToString(e.a!)})`
    case "pm": return `(${exprToString(e.a!)} ** ${e.e} mod ${e.k})`
    case "<<": case ">>": return `(${exprToString(e.a!)} ${e.op} ${e.k})`
    case "%": return `(${exprToString(e.a!)} % ${e.k})`
    default:  return `(${exprToString(e.a!)} ${e.op} ${exprToString(e.b!)})`
  }
}

export const exprSize = (e: Expr): number => 1 + (e.a ? exprSize(e.a) : 0) + (e.b ? exprSize(e.b) : 0)
const exprConstBits = (e: Expr): number =>
  (e.op === "c" || e.op === "<<" || e.op === ">>" || e.op === "%" ? gammaBits(e.k!) : 0) + (e.op === "pm" ? gammaBits(e.k!) + gammaBits(e.e!) : 0) + (e.a ? exprConstBits(e.a) : 0) + (e.b ? exprConstBits(e.b) : 0)
export const exprCostBits = (e: Expr): number => 4 * exprSize(e) + exprConstBits(e)

export type Mode = "byte" | "bit"

export interface SearchResult { expr: Expr; costBits: number; explored: number }
export interface SearchOptions { maxSize?: number; points?: number; layerCap?: number; paramMaxSize?: number; paramRange?: number; budgetNodes?: number }

const LEAF_CONSTS = [1, 2, 3, 4, 5, 7, 8, 16, 255]

/** Busca la expresión más barata (en costo-bits) que reproduce `target` (bytes, o 0/1 si mode="bit") para n = 0..len-1. */
export const searchExpr = (target: Uint8Array, mode: Mode, opts: SearchOptions = {}): SearchResult | null => {
  const P = Math.min(opts.points ?? 96, target.length)
  const maxSize = opts.maxSize ?? 6
  const cap = opts.layerCap ?? 40000
  const paramMax = opts.paramMaxSize ?? 4
  const paramRange = opts.paramRange ?? 1024
  const budget = opts.budgetNodes ?? 600000
  const mask = mode === "byte" ? 255 : 1
  const tgt = Int32Array.from(target.subarray(0, P))

  const exprs: Expr[] = [], sigs: Int32Array[] = [], sizes: number[] = []
  const seen = new Set<string>()
  const layers: number[][] = Array.from({ length: maxSize + 1 }, () => [])
  const box: { best: SearchResult | null } = { best: null }

  const keyOf = (s: Int32Array): string => {
    let h1 = 2166136261 | 0, h2 = 5381
    for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s[i]!, 16777619); h2 = (Math.imul(h2, 33) + s[i]!) | 0 }
    return h1 + ":" + h2
  }
  const matches = (s: Int32Array): boolean => { for (let i = 0; i < P; i++) if ((s[i]! & mask) !== tgt[i]) return false; return true }
  const full = (e: Expr): boolean => { for (let i = 0; i < target.length; i++) if ((evalExpr(e, i) & mask) !== target[i]) return false; return true }
  const consider = (e: Expr, size: number) => {
    const cost = exprCostBits(e)
    if (box.best && cost >= box.best.costBits) return
    if (full(e)) box.best = { expr: e, costBits: cost, explored: exprs.length }
  }
  const add = (e: Expr, s: Int32Array, size: number): void => {
    const k = keyOf(s)
    if (seen.has(k)) return
    seen.add(k)
    const id = exprs.length
    exprs.push(e); sigs.push(s); sizes.push(size)
    if (layers[size]!.length < cap) layers[size]!.push(id)
    if (matches(s)) consider(e, size)
  }

  // hojas
  add({ op: "n" }, Int32Array.from({ length: P }, (_, i) => i), 1)
  for (const c of LEAF_CONSTS) add({ op: "c", k: c }, new Int32Array(P).fill(c), 1)
  const constLeaf = new Map<number, number>()
  for (let i = 0; i < exprs.length; i++) if (exprs[i]!.op === "c") constLeaf.set(exprs[i]!.k!, i)

  const bin: Array<[Op, (x: number, y: number) => number]> = [
    ["+", (x, y) => (x + y) >>> 0], ["-", (x, y) => (x - y) >>> 0], ["*", (x, y) => Math.imul(x, y) >>> 0],
    ["^", (x, y) => (x ^ y) >>> 0], ["&", (x, y) => (x & y) >>> 0], ["|", (x, y) => (x | y) >>> 0],
  ]
  for (let s = 2; s <= maxSize && exprs.length < budget; s++) {
    // unarios: pc
    for (const a of layers[s - 1]!) {
      const sa = sigs[a]!, o = new Int32Array(P)
      for (let i = 0; i < P; i++) o[i] = pc32(sa[i]! >>> 0)
      add({ op: "pc", a: exprs[a]! }, o, s)
    }
    // shifts y módulo por constante (la constante cuenta como un nodo hoja: size = 1 + sizeA + 1)
    if (s >= 3) for (const a of layers[s - 2]!) {
      const sa = sigs[a]!
      for (let k = 1; k <= 16; k++) {
        const l = new Int32Array(P), r = new Int32Array(P)
        for (let i = 0; i < P; i++) { l[i] = (sa[i]! << k) >>> 0; r[i] = sa[i]! >>> k }
        add({ op: "<<", a: exprs[a]!, k }, l, s); add({ op: ">>", a: exprs[a]!, k }, r, s)
      }
      for (const m of [2, 3, 5, 7, 9, 11, 13, 16, 17, 31, 61, 127, 251, 255, 257]) {
        const o = new Int32Array(P)
        for (let i = 0; i < P; i++) o[i] = (sa[i]! >>> 0) % m
        add({ op: "%", a: exprs[a]!, k: m }, o, s)
      }
    }
    // binarios
    for (let i = 1; i <= s - 2; i++) {
      const j = s - 1 - i
      if (j < i) continue
      for (const a of layers[i]!) for (const b of layers[j]!) {
        const sa = sigs[a]!, sb = sigs[b]!
        for (const [op, f] of bin) {
          const o = new Int32Array(P)
          for (let q = 0; q < P; q++) o[q] = f(sa[q]! >>> 0, sb[q]! >>> 0)
          add({ op, a: exprs[a]!, b: exprs[b]! }, o, s)
          if (op === "-" && i !== j) { // no conmutativo: ambos órdenes
            const o2 = new Int32Array(P); for (let q = 0; q < P; q++) o2[q] = (sb[q]! - sa[q]!) >>> 0
            add({ op, a: exprs[b]!, b: exprs[a]! }, o2, s)
          }
        }
        if (exprs.length >= budget) break
      }
      if (exprs.length >= budget) break
    }
    if (box.best && 4 * (s + 1) >= box.best.costBits) break // ninguna expresión de mayor tamaño puede ser más barata
  }

  // Constantes libres en la raíz: e % C, e * C, e + C, e ^ C, e & C, e >> C sobre expresiones pequeñas
  const small = exprs.map((_, i) => i).filter(i => sizes[i]! <= paramMax)
  const tryTop = (op: Op, id: number, C: number, f: (x: number) => number) => {
    const sa = sigs[id]!
    for (let i = 0; i < P; i++) if ((f(sa[i]! >>> 0) & mask) !== tgt[i]) return
    const e: Expr = op === "%" || op === ">>" || op === "<<" ? { op, a: exprs[id]!, k: C } : { op, a: exprs[id]!, b: { op: "c", k: C } }
    consider(e, 0)
  }
  for (const id of small) {
    for (let C = 1; C <= paramRange; C++) {
      tryTop("%", id, C, x => x % C)
      tryTop("*", id, C, x => Math.imul(x, C) >>> 0)
      tryTop("+", id, C, x => (x + C) >>> 0)
      tryTop("^", id, C, x => (x ^ C) >>> 0)
      tryTop("&", id, C, x => (x & C) >>> 0)
      if (C < 32) tryTop(">>", id, C, x => x >>> C)
    }
  }
  // Potencia modular con módulo primo < 2048 y exponente en {2,3,4,5,(M-1)/2,M-2} sobre expresiones muy pequeñas
  const primes: number[] = []
  for (let q = 3; q < 2048; q += 2) { let ok = true; for (let d = 3; d * d <= q; d += 2) if (q % d === 0) { ok = false; break } if (ok) primes.push(q) }
  for (const id of small.filter(i => sizes[i]! <= 3)) {
    const sa = sigs[id]!
    for (const M of primes) for (const K of new Set([2, 3, 4, 5, (M - 1) / 2, M - 2])) {
      let ok = true
      for (let i = 0; i < P; i++) if ((powMod(sa[i]! >>> 0, K, M) & mask) !== tgt[i]) { ok = false; break }
      if (ok) consider({ op: "pm", a: exprs[id]!, k: M, e: K }, 0)
    }
  }
  return box.best ? { ...box.best, explored: exprs.length } : null
}
