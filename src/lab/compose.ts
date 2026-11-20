// Sintetizador COMPOSICIONAL (laboratorio, exp. 10): pelado de capas guiado por propiedades.
//
//   y  --peeler-->  z  (con y = wrap(z))   ...   hasta que z cae en un solver hoja (poly, gf2, beatty, anf, periódico).
//
// Peelers del lado de la SALIDA (y = g(z)): delta/prefijo, capas enumeradas de 8 bits (xorc, addc, mulo, rotl),
// y el levantamiento triangular 2-ádico del mapa afín GF(2) sobre bytes (baffLift).
// Peelers del lado del ÍNDICE (y(n) = z(A·n ^ k)): cociente por el grupo de simetrías XOR (idxQuotient) y
// levantamiento triangular del mapa afín de índices (idxLiftPoly).
// Ningún módulo de generación oculta se importa aquí (un test lo comprueba).

import * as zlib from "zlib"
import { Node, evalVec, costBits, simplify, show } from "./ast"
import { pow2Period, polyDegree, incrementAlphabet, isGf2Affine, xorSymmetry } from "./probes"

const PAR = new Uint8Array(256); for (let i = 0; i < 256; i++) { let v = i, p = 0; while (v) { p ^= v & 1; v >>= 1 } PAR[i] = p }

const same = (a: Uint8Array, b: Uint8Array): boolean => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
export const verify = (node: Node, y: Uint8Array): boolean => same(evalVec(simplify(node), y.length), y)

// ── solvers hoja (devuelven AST; las constantes se RESUELVEN, no se enumeran) ───────────────────
export const leafGf2 = (y: Uint8Array): Node | null => {
  const K = Math.floor(Math.log2(y.length)); if (K < 2 || !isGf2Affine(y.subarray(0, 1 << K))) return null
  const c0 = y[0]!, col: number[] = []; for (let i = 0; i < K; i++) col.push(y[1 << i]! ^ c0)
  return { t: "gf2", K, c0, col }
}
export const leafPoly = (y: Uint8Array): Node | null => {
  const k = polyDegree(y); if (k < 0) return null
  let cur = Array.from(y.subarray(0, Math.min(y.length, 2048))); const coef: number[] = []
  for (let d = 0; d < k; d++) { coef.push(cur[0]!); const nx = new Array<number>(cur.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = (cur[i + 1]! - cur[i]!) & 255; cur = nx }
  return { t: "poly", coef }
}
export const leafBeatty = (y: Uint8Array): Node | null => {
  const N = y.length; if (N < 64 || incrementAlphabet(y) > 2) return null
  const cnt = new Uint32Array(256); for (let n = 0; n < N - 1; n++) cnt[(y[n + 1]! - y[n]!) & 255]++
  const vals: number[] = []; for (let v = 0; v < 256; v++) if (cnt[v]) vals.push(v)
  let q: number, frac: number
  if (vals.length === 1) { q = vals[0]!; frac = 0 }
  else { const [v1, v2] = vals as [number, number]; if (((v2 - v1) & 255) === 1) { q = v1; frac = cnt[v2]! / (N - 1) } else if (((v1 - v2) & 255) === 1) { q = v2; frac = cnt[v1]! / (N - 1) } else return null }
  const alpha = q + frac, tol = 3 / N
  for (let s = 0; s <= 24; s++) {
    const M = 2 ** (s + 8), W = 2 ** s
    const aLo = Math.floor((alpha - tol) * W), aHi = Math.ceil((alpha + tol) * W)
    if (aHi - aLo > 20000) continue
    for (let a = aLo; a <= aHi; a++) {
      const aM = ((a % M) + M) % M, L0 = y[0]! * W
      let lo = 0, hi = W, ok = true
      for (let n = 1; n < N && ok; n++) {
        const c = (aM * n) % M, t = (((y[n]! * W - c) % M) + M) % M
        let r = (((t - L0) % M) + M) % M; if (r >= M - W) r -= M
        lo = Math.max(lo, r); hi = Math.min(hi, r + W); if (lo >= hi) ok = false
      }
      if (!ok) continue
      const bp = (((L0 + Math.floor((lo + hi - 1) / 2)) % M) + M) % M
      const node: Node = { t: "beatty", a: aM >>> 0, b: bp >>> 0, s }
      if (verify(node, y)) return node
    }
  }
  return null
}
export const leafAnf = (y: Uint8Array, cap = 400): Node | null => {
  const N = y.length, K = Math.round(Math.log2(N)); if (2 ** K !== N || K < 3 || K > 20) return null
  const monos: number[][] = [], f = new Uint8Array(N); let total = 0
  for (let j = 0; j < 8; j++) {
    for (let n = 0; n < N; n++) f[n] = (y[n]! >> j) & 1
    for (let i = 0; i < K; i++) { const b = 1 << i; for (let n = 0; n < N; n++) if (n & b) f[n]! ^= f[n ^ b]! }
    const l: number[] = []; for (let n = 0; n < N; n++) if (f[n]) l.push(n)
    total += l.length; if (total > cap) return null; monos.push(l)
  }
  return { t: "anf", K, monos }
}
export const leafPeriodic = (y: Uint8Array): Node | null => { const P = pow2Period(y); return P ? { t: "table", data: Array.from(y.subarray(0, P)) } : null }
const LEAVES: ReadonlyArray<readonly [string, (y: Uint8Array) => Node | null]> = [["poly", leafPoly], ["gf2", leafGf2], ["beatty", leafBeatty], ["anf", (y) => leafAnf(y)]]

// ── utilidades GF(2) pequeñas ───────────────────────────────────────────────────────────────────
const rankOf = (vs: number[]): number => { const b: number[] = []; for (const v of vs) { let x = v; for (const e of b) x = Math.min(x, x ^ e); if (x) b.push(x) } return b.length }

const basisOf = (vs: number[]): number[] => { const b: number[] = []; for (const v of vs) { let x = v; for (const e of b) x = Math.min(x, x ^ e); if (x) b.push(x) } return b }
const reduceBy = (b: number[], v: number): number => { let x = v; for (const e of b) x = Math.min(x, x ^ e); return x }

/** ¿T (valores mod 2^m, indexado mod 2^m) es una función polinómica entera-valuada mod 2^m? (Δ^D = 0, D <= 10) */
const PEEL_MAX_DEGREE = 4   // familia declarada para el PELADO: polinomios de grado <= 4 (las hojas aceptan hasta 12)
const V2FACT = [0, 0, 1, 1, 3, 3, 4, 4]   // v2(k!) para k = 0..7
/**
 * ¿T (valores mod 2^m, indexado mod 2^m) es una función polinómica mod 2^m con COEFICIENTES ENTEROS de grado <= PEEL_MAX_DEGREE?
 * Δ^D = 0 y además c_k = Δ^k T(0) ≡ 0 (mod 2^v2(k!)): para p con coeficientes enteros, Δ^k p(0) = k!·(entero). Es más estricto que
 * "entero-valuado" y poda más (familia declarada del pelado; las hojas siguen aceptando entero-valuados hasta grado 12).
 */
const isPolyModTable = (T: number[], m: number): boolean => {
  const L = 1 << m, mask = L - 1
  let cur = new Array<number>(L + 12); for (let i = 0; i < cur.length; i++) cur[i] = T[i & mask]!
  for (let D = 0; D <= PEEL_MAX_DEGREE + 1; D++) {
    if (D > 0 || true) { const need = Math.min(m, V2FACT[D]!); if (need > 0 && (cur[0]! & ((1 << need) - 1)) !== 0) return false }
    let z = true; for (let i = 0; i < L; i++) if ((cur[i]! & mask) !== 0) { z = false; break }
    if (z) return true
    const nx = new Array<number>(cur.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = (cur[i + 1]! - cur[i]!) & mask; cur = nx
  }
  return false
}

// ── peelers ─────────────────────────────────────────────────────────────────────────────────────
export interface Cand { z: Uint8Array; wrap: (x: Node) => Node; name: string }
const xorDelta = (y: Uint8Array): Uint8Array => { const z = new Uint8Array(y.length); z[0] = y[0]!; for (let i = 1; i < y.length; i++) z[i] = y[i]! ^ y[i - 1]!; return z }
const addDelta = (y: Uint8Array): Uint8Array => { const z = new Uint8Array(y.length); z[0] = y[0]!; for (let i = 1; i < y.length; i++) z[i] = (y[i]! - y[i - 1]!) & 255; return z }

const promising = (z: Uint8Array): boolean => {
  const w = z.subarray(0, Math.min(z.length, 4096))
  return polyDegree(w) >= 0 || incrementAlphabet(w) <= 2 || isGf2Affine(w.subarray(0, 1 << Math.floor(Math.log2(w.length))))
}
const inv8 = (m: number): number => { for (let i = 1; i < 256; i += 2) if (((i * m) & 255) === 1) return i; return 1 }

export const peelEnumerated = (y: Uint8Array): Cand[] => {
  const out: Cand[] = [], N = y.length, W = Math.min(N, 4096), w = new Uint8Array(W)
  const maps: Array<[string, number, (v: number, p: number) => number, (p: number) => (x: Node) => Node]> = []
  for (let k = 1; k < 256; k++) maps.push(["xorc", k, (v, p) => v ^ p, (p) => (x) => ({ t: "xorc", k: p, x })])
  for (let k = 1; k < 256; k++) maps.push(["addc", k, (v, p) => (v - p) & 255, (p) => (x) => ({ t: "addc", k: p, x })])
  for (let m = 3; m < 256; m += 2) { const mi = inv8(m); maps.push(["mulo", m, (v) => (v * mi) & 255, (p) => (x) => ({ t: "mulo", m: p, x })]) }
  for (let r = 1; r < 8; r++) maps.push(["rotl", r, (v, p) => ((v >> p) | (v << (8 - p))) & 255, (p) => (x) => ({ t: "rotl", r: p, x })])
  for (const [name, p, f, wr] of maps) {
    for (let n = 0; n < W; n++) w[n] = f(y[n]!, p)
    if (!promising(w)) continue
    const z = new Uint8Array(N); for (let n = 0; n < N; n++) z[n] = f(y[n]!, p)
    out.push({ z, name, wrap: wr(p) })
  }
  return out
}

/** Ajuste afín GF(2) 8->8: halla rows/k con paridad(rows[i]&x)^k_i = bit i de t para todos los pares (x,t); null si es inconsistente. */
const fitAffine = (pairs: Array<[number, number]>): { rows: number[]; k: number } | null => {
  const rows: number[] = new Array(8).fill(0); let k = 0
  for (let i = 0; i < 8; i++) {
    const eq: number[] = pairs.map(([x, t]) => (x << 1) | 1 | (((t >> i) & 1) << 9))   // bits: [x(8) | 1 (const) | rhs en bit 9] -> columnas 1..8 = x, 0 = const
    const piv: number[] = []   // eliminación
    const basis: number[] = []
    for (let e of eq) { for (const b of basis) { const hb = 31 - Math.clz32(b & 0x1ff); if ((e >> hb) & 1) e ^= b }; if ((e & 0x1ff) === 0) { if ((e >> 9) & 1) return null; continue } basis.push(e); basis.sort((x, y) => (y & 0x1ff) - (x & 0x1ff)) }
    void piv
    // resolver por sustitución hacia atrás con variables libres = 0
    const val = new Array<number>(9).fill(0), sorted = basis.slice().sort((x, y) => (x & 0x1ff) - (y & 0x1ff))
    for (const e of sorted) { const hb = 31 - Math.clz32(e & 0x1ff); let v = (e >> 9) & 1; for (let c = 0; c < hb; c++) if ((e >> c) & 1) v ^= val[c]!; val[hb] = v }
    k |= val[0]! << i; let r = 0; for (let c = 0; c < 8; c++) r |= val[c + 1]! << c; rows[i] = r
  }
  return { rows, k }
}

/**
 * Levantamiento triangular 2-ádico: busca z = M·y ^ m (afín sobre GF(2)) tal que z sea un polinomio mod 256.
 * Propiedad que sobrevive a la capa: el bit j de un polinomio mod 256 depende solo de n mod 2^(j+1) (triangularidad); el span de los
 * planos de y es invariante bajo M. Se eligen z_j dentro del subespacio V_{j+1} (combinaciones que dependen solo de n mod 2^(j+1)) y se
 * poda con la consistencia polinómica de z mod 2^(j+1). Condición de inyectividad sobre el rango de y: span(a) + V_0 = GF(2)^8.
 * Se admiten (hasta dim V_0) filas dependientes módulo V_0 (planos de p con relación afín). Período arbitrario (se tesela a 256).
 */
/** Constantes del contador de trabajo (unidad ≈ 1 ns de CPU en la máquina de referencia; ver lab-16-primitives-raw.txt).
 *  El contador NO lee el reloj: mismo código y mismos datos => mismo trabajo => mismos resultados en cualquier máquina. */
export const COST = { leafFixed: 5e5, leafPerElem: 40, enumFixed: 2.5e7, enumPerElem: 1400, baffFixed: 6e5, baffNode: 8000, idxqPerElem: 400, liftFixed: 1e7, liftState: 30000, liftNode: 3000, il2PerElem: 20 }
export const prof: Record<string, number> = {}
const timed = <T,>(name: string, f: () => T): T => { const t = performance.now(); const r = f(); prof[name] = (prof[name] ?? 0) + performance.now() - t; return r }
export const dbgI = { states: 0, nodes: 0 }
export const dbg = { nodes: 0, reach: new Array(9).fill(0) as number[] }
export const baffLift = (y: Uint8Array, nodeCap = 3000000, tick?: (units: number) => boolean): Cand[] => {
  dbg.nodes = 0; dbg.reach.fill(0)
  const N = y.length; if (N < 16 || (N & (N - 1)) !== 0) return []
  const T = new Uint8Array(256); for (let n = 0; n < 256; n++) T[n] = y[n & (N - 1)]!
  for (let n = 0; n < N; n++) if (y[n] !== T[n & 255]) return []
  const V: number[][] = []
  for (let k = 0; k <= 8; k++) {
    const mask = (1 << k) - 1, l: number[] = []
    for (let a = 0; a < 256; a++) { let ok = true; for (let n = 0; n < 256 && ok; n++) if (PAR[a & T[n]!] !== PAR[a & T[n & mask]!]) ok = false; if (ok) l.push(a) }
    V.push(l)
  }
  // Puerta exacta (condición necesaria): a_j ∈ V_{j+1}, y a lo sumo dim V_0 filas son dependientes módulo V_0 => dim V_k >= k para k = 1..8.
  for (let k = 1; k <= 8; k++) if (Math.log2(V[k]!.length) < k) return []
  const V0 = V[0]!, d0 = Math.log2(V0.length)
  const seen = new Set<number>(); for (let n = 0; n < 256; n++) seen.add(T[n]!)
  const found: Cand[] = []; let nodes = 0, dep = 0, stop = false
  const aSel: number[] = [], mSel: number[] = []
  const rec = (j: number): void => {
    dbg.reach[j]!++; dbg.nodes = nodes
    if (found.length >= 8 || nodes > nodeCap || stop) return
    if (j === 8) {
      if (rankOf([...V0, ...aSel]) !== 8) return
      const lutZ = new Uint8Array(256)
      for (let t = 0; t < 256; t++) { let z = 0; for (let i = 0; i < 8; i++) z |= (PAR[aSel[i]! & t]! ^ mSel[i]!) << i; lutZ[t] = z }
      const zs = new Set<number>(); for (const t of seen) zs.add(lutZ[t]!)
      if (zs.size !== seen.size) return                                      // no inyectivo sobre el rango
      const z = new Uint8Array(N); for (let n = 0; n < N; n++) z[n] = lutZ[y[n]!]!
      if (polyDegree(z) < 0) return
      const fit = fitAffine(Array.from(seen).map((t) => [lutZ[t]!, t] as [number, number]))
      if (!fit) return
      const { rows, k } = fit
      found.push({ z, name: "baff", wrap: (x) => ({ t: "baff", rows, k, x }) })
      return
    }
    const m2 = (1 << (j + 1)) - 1
    // base reducida de V0 ∪ aSel y tabla prefijo z_{<j}(n) (se reutilizan para todos los candidatos del estado)
    const basis: number[] = []
    for (const v of [...V0, ...aSel]) { let x = v; for (const e of basis) x = Math.min(x, x ^ e); if (x) basis.push(x) }
    const pref = new Int32Array(m2 + 1)
    for (let n = 0; n <= m2; n++) { let v = 0; for (let i = 0; i < j; i++) v |= (PAR[aSel[i]! & T[n]!]! ^ mSel[i]!) << i; pref[n] = v }
    const tab: number[] = new Array(m2 + 1)
    for (const a of V[j + 1]!) {
      if (a === 0) continue
      if (V0.length > 1 && !V0.includes(a) && V0.some((v) => (a ^ v) < a)) continue   // un representante por clase módulo V_0
      let x = a; for (const e of basis) x = Math.min(x, x ^ e)
      const incr = x !== 0
      if (!incr && dep >= d0) continue
      for (let m = 0; m < 2; m++) {
        nodes++
        if (tick && tick(COST.baffNode)) { stop = true; return }                 // presupuesto determinista (unidades de trabajo)
        for (let n = 0; n <= m2; n++) tab[n] = pref[n]! | ((PAR[a & T[n]!]! ^ m) << j)
        if (!isPolyModTable(tab, j + 1)) continue
        aSel.push(a); mSel.push(m); if (!incr) dep++
        rec(j + 1)
        aSel.pop(); mSel.pop(); if (!incr) dep--
      }
    }
  }
  rec(0)
  return found
}

/** Cociente por el grupo de simetrías XOR del índice: y(n) = z(R·n), R de r filas (z tiene 2^r entradas). */
export const idxQuotient = (y: Uint8Array): Cand[] => {
  const N = y.length, K = Math.round(Math.log2(N)); if (2 ** K !== N || K < 4) return []
  const g = xorSymmetry(y); if (g.dim <= 0) return []
  const r = K - g.dim; if (r < 1 || r > 10) return []
  const pivots = g.basis.map((b) => 31 - Math.clz32(b))
  const free: number[] = []; for (let i = 0; i < K; i++) if (!pivots.includes(i)) free.push(i)
  const rows = free.map((f) => { let m = 1 << f; g.basis.forEach((b, i) => { if ((b >> f) & 1) m |= 1 << pivots[i]! }); return m })
  const z = new Uint8Array(1 << r)
  for (let c = 0; c < 1 << r; c++) { let n = 0; for (let f = 0; f < r; f++) if ((c >> f) & 1) n |= 1 << free[f]!; z[c] = y[n]! }
  return [{ z, name: "idxq", wrap: (x) => ({ t: "idx", bits: K, rows, k: 0, x }) }]
}

/**
 * Levantamiento triangular del mapa afín del ÍNDICE: z(c) = T[A·c ^ b] con T polinomio mod 256 (dominio c de 8 bits).
 * Propiedad: el plano j depende solo de las formas lineales u_0..u_j (subespacio de dependencia S_j = anulador de las simetrías del plano);
 * S_j ⊆ span(a_0..a_j). Se poda con la consistencia polinómica mod 2^(j+1).
 */
export const idxLiftPoly = (z: Uint8Array, nodeCap = 300000, tick?: (units: number) => boolean): Cand[] => {
  if (z.length !== 256) return []
  const S: number[][] = []
  for (let j = 0; j < 8; j++) {
    const H: number[] = []
    for (let v = 1; v < 256; v++) { let ok = true; for (let c = 0; c < 256 && ok; c++) if (((z[c ^ v]! >> j) & 1) !== ((z[c]! >> j) & 1)) ok = false; if (ok) H.push(v) }
    const ann: number[] = []; for (let a = 1; a < 256; a++) { let ok = true; for (const v of H) if (PAR[a & v]) { ok = false; break } if (ok) ann.push(a) }
    S.push(ann)
    // Puerta exacta (condición necesaria): S_j ⊆ span(a_0..a_j) que tiene dimensión j+1 => rank(S_j) <= j+1 o no existe cadena.
    if (basisOf(ann).length > j + 1) return []
  }
  const Sb = S.map((a) => basisOf(a))
  const found: Cand[] = []; let nodes = 0, stop = false
  const aSel: number[] = [], bSel: number[] = []
  dbgI.states = 0; dbgI.nodes = 0
  const rec = (j: number): void => {
    dbgI.states++
    if (tick && tick(COST.liftState)) { stop = true; return }            // coste por estado: bucle sobre 255 candidatos
    if (found.length >= 8 || nodes > nodeCap || stop) return
    if (j === 8) {
      const T = new Uint8Array(256)
      for (let c = 0; c < 256; c++) { let x = 0; for (let i = 0; i < 8; i++) x |= (PAR[aSel[i]! & c]! ^ bSel[i]!) << i; T[x] = z[c]! }
      if (polyDegree(T) < 0) return
      const rows = aSel.slice(); let k = 0; for (let i = 0; i < 8; i++) k |= bSel[i]! << i
      found.push({ z: T, name: "idxlift", wrap: (x) => ({ t: "idx", bits: 8, rows, k, x }) })
      return
    }
    const mask = (1 << (j + 1)) - 1
    const basisA = basisOf(aSel)
    for (let a = 1; a < 256; a++) {
      const ra = reduceBy(basisA, a)
      if (ra === 0) continue                                   // a dependiente de las filas ya elegidas
      if (Sb[j]!.length) { const bb = [...basisA, ra]; let ok = true; for (const sv of Sb[j]!) if (reduceBy(bb, sv) !== 0) { ok = false; break } if (!ok) continue }   // S_j ⊆ span
      for (let b = 0; b < 2; b++) {
        nodes++; dbgI.nodes++
        if (tick && tick(COST.liftNode * (j + 1))) { stop = true; return }
        aSel.push(a); bSel.push(b)
        const tab = new Array<number>(mask + 1).fill(-1); let ok = true
        for (let c = 0; c < 256 && ok; c++) {
          let x = 0; for (let i = 0; i <= j; i++) x |= (PAR[aSel[i]! & c]! ^ bSel[i]!) << i
          const v = z[c]! & mask; if (tab[x] === -1) tab[x] = v; else if (tab[x] !== v) ok = false
        }
        if (ok && isPolyModTable(tab, j + 1)) rec(j + 1)
        aSel.pop(); bSel.pop()
      }
    }
  }
  rec(0)
  return found
}

// ── búsqueda ────────────────────────────────────────────────────────────────────────────────────
export interface SearchOpts { maxDepth: number; ms?: number; work?: number; peelers?: string[]; greedy?: number; il2Gate?: "legacy" | "bound"; staged?: boolean }   // greedy: fracción del respaldo bajo la cual una hoja se acepta sin explorar capas (0.1 = comportamiento del lote B; 0 = nunca)
export interface Found { node: Node; cost: number; path: string[]; ms: number; visited: number; work: number; stageCosts: number[]; timedOut: boolean }
interface Ctx { deadline: number; visited: number; opts: SearchOpts; work: number; limit: number }
interface Sub { node: Node; cost: number; path: string[] }
const MIN_COMPOSED_BITS = costBits({ t: "xorc", k: 1, x: { t: "poly", coef: [0] } })   // capa + hoja mínimas
const MIN_LEAF: Node = { t: "poly", coef: [0] }
// Cotas inferiores estáticas del costo de una composición con cada peeler (capa mínima + hoja mínima), calculadas del códec.
const LB_DELTA = costBits({ t: "prefix", op: "xor", x: MIN_LEAF })
const LB_BAFF = costBits({ t: "baff", rows: [0, 0, 0, 0, 0, 0, 0, 0], k: 0, x: MIN_LEAF })
const LB_IDXLIFT = costBits({ t: "idx", bits: 8, rows: [0, 0, 0, 0, 0, 0, 0, 0], k: 0, x: MIN_LEAF })
const LB_IL2 = costBits({ t: "il2", a: MIN_LEAF, b: MIN_LEAF })
const ENUM_NAMES = ["xorc", "addc", "mulo", "rotl"]
/** Presupuesto determinista: unidades de trabajo ≈ operaciones elementales. `ms` es solo un seguro de última instancia. */
const charge = (ctx: Ctx, units: number): void => { ctx.work += units }
const spent = (ctx: Ctx): boolean => ctx.work > ctx.limit || performance.now() > ctx.deadline
const on = (ctx: Ctx, name: string): boolean => !ctx.opts.peelers || ctx.opts.peelers.includes(name)

const search = (y: Uint8Array, depth: number, last: string, ctx: Ctx, literal: boolean, ub: number = Infinity): Sub | null => {
  ctx.visited++
  charge(ctx, COST.leafFixed + COST.leafPerElem * y.length)       // 5 hojas (medido: ~0,5 ms + ~40 ns/elemento)
  let best: Sub | null = null
  for (const [name, solve] of LEAVES) { const n = solve(y); if (n) { const c = costBits(n); if (!best || c < best.cost) best = { node: n, cost: c, path: [name] } } }
  // Respaldos (no son fórmulas): tabla periódica y tabla literal. Fijan el costo contra el que compite un pelado.
  const per = leafPeriodic(y)
  const fb: Sub | null = per ? { node: per, cost: costBits(per), path: ["periodic"] } : null
  const lit: Sub | null = literal && y.length <= 4096 && (y.length & (y.length - 1)) === 0 ? { node: { t: "table", data: Array.from(y) }, cost: 4 + 4 + 8 * y.length, path: ["literal"] } : null
  const fallback = Math.min(fb ? fb.cost : Infinity, lit ? lit.cost : Infinity, 8 * y.length)
  // Control de búsqueda: una hoja se acepta sin explorar capas solo si NINGUNA composición puede costar menos que ella.
  // Una composición necesita al menos una capa + una hoja: su costo mínimo se calcula del propio códec (no es una constante ajustada).
  // `greedy` (fracción del respaldo) reproduce la regla anterior (0.1 en el lote B) y solo se usa para reproducir esa corrida.
  const limit = ctx.opts.greedy !== undefined ? ctx.opts.greedy * fallback : MIN_COMPOSED_BITS
  if (best && best.cost <= limit) return best     // goloso solo si la hoja es muy barata frente al respaldo
  const lim = (): number => Math.min((best as Sub | null)?.cost ?? Infinity, ub)   // incumbente: mejor local o cota superior heredada
  const worth = (lb: number): boolean => lb < lim()   // branch-and-bound: solo se explora lo que aún puede ganar
  const consider = (cand: Cand, d = depth - 1): void => {
    if (spent(ctx)) return
    if (!worth(costBits(simplify(cand.wrap(MIN_LEAF))))) return      // cota exacta: capa de este candidato + la hoja más barata posible
    // cota superior para la sub-representación; para idx no se resta la capa porque simplify fusiona idx∘idx (la suma no sería cota válida)
    const layer = costBits(simplify(cand.wrap(MIN_LEAF))) - costBits(MIN_LEAF)
    const subUb = cand.name.startsWith("idx") ? lim() : lim() - layer
    const sub = search(cand.z, d, cand.name, ctx, d > 0, subUb)
    if (!sub || (d === 0 && sub.path[0] === "periodic")) return
    const node = cand.wrap(sub.node), cost = costBits(simplify(node))
    if (!best || cost < best.cost) best = { node, cost, path: [cand.name, ...sub.path] }
  }
  if (depth > 0 && !spent(ctx)) {
    if (on(ctx, "enum") && !ENUM_NAMES.includes(last) && !spent(ctx)) { charge(ctx, COST.enumFixed + COST.enumPerElem * y.length); for (const c of timed("enum", () => peelEnumerated(y))) { timed("consider:enum", () => consider(c, 0)) } }   // solo hojas (sin recursión); sin apilar capas enumeradas (xorc∘addc∘... son redundantes)
    const tick = (u: number): boolean => { charge(ctx, u); return spent(ctx) }
    if (on(ctx, "baff") && last !== "baff" && worth(LB_BAFF) && !spent(ctx)) { charge(ctx, COST.baffFixed + y.length); const t0b = performance.now(); const bl = timed("baffLift", () => baffLift(y, 3000000, tick)); const db = performance.now() - t0b
      if (process.env.TRACE_LIFT && db > 300) console.error(`[baffLift lento] ${db.toFixed(0)} ms depth=${depth} last=${last} len=${y.length} best=${(best as Sub | null)?.cost ?? "-"} nodos=${dbg.nodes} reach=${dbg.reach.join(",")} cands=${bl.length}`)
      for (const c of bl) timed("consider:baff", () => consider(c)) }
    if (on(ctx, "idx") && last !== "idxq" && !spent(ctx)) { charge(ctx, COST.idxqPerElem * y.length); for (const c of timed("idxQuotient", () => idxQuotient(y))) timed("consider:idxq", () => consider(c)) }
    if (on(ctx, "idx") && last !== "idxlift" && worth(LB_IDXLIFT) && !spent(ctx)) { charge(ctx, COST.liftFixed); const t0l = performance.now(); const lifts = timed("idxLiftPoly", () => idxLiftPoly(y, 300000, tick)); const dl = performance.now() - t0l
      if (process.env.TRACE_LIFT && dl > 300) console.error(`[idxLiftPoly lento] ${dl.toFixed(0)} ms depth=${depth} last=${last} len=${y.length} best=${(best as Sub | null)?.cost ?? "-"} estados=${dbgI.states} nodos=${dbgI.nodes} cands=${lifts.length}`)
      for (const c of lifts) timed("consider:idxlift", () => consider(c)) }
    // genéricos y caros al final: los peelers específicos (con puertas exactas) se exploran primero
    if (last !== "xdelta" && on(ctx, "delta") && worth(LB_DELTA) && !spent(ctx)) consider({ z: xorDelta(y), name: "xdelta", wrap: (x) => ({ t: "prefix", op: "xor", x }) })
    if (last !== "adelta" && on(ctx, "delta") && worth(LB_DELTA) && !spent(ctx)) consider({ z: addDelta(y), name: "adelta", wrap: (x) => ({ t: "prefix", op: "add", x }) })
    if (y.length >= 128 && on(ctx, "il2") && !spent(ctx) && (ctx.opts.il2Gate === "legacy" ? !(best as Sub | null) : worth(LB_IL2))) {
      const h = y.length >> 1, l0 = new Uint8Array(h), l1 = new Uint8Array(h)
      for (let i = 0; i < h; i++) { l0[i] = y[2 * i]!; l1[i] = y[2 * i + 1]! }
      charge(ctx, COST.il2PerElem * y.length)
      const leafBits = costBits(MIN_LEAF)
      const s0 = search(l0, depth - 1, "il2", ctx, true, lim() - 4 - leafBits)
      const s1 = s0 ? search(l1, depth - 1, "il2", ctx, true, lim() - 4 - s0.cost) : null
      if (s0 && s1) { const node: Node = { t: "il2", a: s0.node, b: s1.node }, cost = costBits(simplify(node)); const cur = best as Sub | null; if (!cur || cost < cur.cost) best = { node, cost, path: ["il2", `(${s0.path.join(">")}|${s1.path.join(">")})`] } }
    }
  }
  let b = best as Sub | null
  for (const f of [fb, lit]) if (f && (!b || f.cost < b.cost)) b = f
  return b
}

/** Presupuesto de la etapa d (profundidad d): depende solo de (work, d), NO de maxDepth => el resultado es monótono en maxDepth. */
export const stageWork = (work: number, d: number): number => work * 2 ** d
export const DEFAULT_WORK = 7e8   // por etapa; con maxDepth=3 el total máximo es 15·W ≈ 10G unidades ≈ 3-4 s

export const discoverCompose = (y: Uint8Array, opts: SearchOpts = { maxDepth: 3 }): Found | null => {
  const t0 = performance.now(), W = opts.work ?? DEFAULT_WORK, hardMs = opts.ms ?? 120000
  // Reducción por período: si y es 2^m-periódica se busca sobre un período; la verificación final es sobre y completa.
  const P = pow2Period(y), yy = P >= 64 && P < y.length ? y.slice(0, P) : y
  let best: { node: Node; cost: number; path: string[] } | null = null
  let work = 0, visited = 0, timedOut = false
  const stageCosts: number[] = []
  const stages = opts.staged === false ? [opts.maxDepth] : Array.from({ length: opts.maxDepth + 1 }, (_, d) => d)   // 0..maxDepth
  for (const d of stages) {
    const ctx: Ctx = { deadline: t0 + hardMs, visited: 0, opts, work: 0, limit: stageWork(W, d) }
    const ubStage = best ? best.cost : Infinity
    let r = search(yy, d, "", ctx, false, ubStage)
    if (r && yy !== y && !verify(simplify(r.node), y)) r = search(y, d, "", { ...ctx, work: 0 }, false, ubStage)
    work += ctx.work; visited += ctx.visited
    if (performance.now() > ctx.deadline) timedOut = true
    if (r) { const node = simplify(r.node); if (verify(node, y)) { const c = costBits(node); stageCosts.push(c); if (!best || c < best.cost) best = { node, cost: c, path: r.path } } else stageCosts.push(Infinity) } else stageCosts.push(Infinity)
    if (best && best.cost <= MIN_COMPOSED_BITS) break      // ninguna composición puede costar menos
    if (timedOut) break
  }
  if (!best) return null
  return { node: best.node, cost: best.cost, path: best.path, ms: performance.now() - t0, visited, work, stageCosts, timedOut }
}
export { show }
export const brotliBits = (y: Uint8Array): number => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
