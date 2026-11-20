// Síntesis de generadores f(n) GUIADA POR PROPIEDADES (laboratorio).
//
// secuencia → [transformación reversible] → test de propiedad barato → solver analítico → verificación exacta
//
// A diferencia de searchExpr (enumeración + rejilla de constantes), aquí las constantes y matrices se
// RESUELVEN: álgebra lineal sobre GF(2), diferencias finitas módulo 256, estructura tipo Beatty (2-ádica),
// transformada de Möbius (ANF). Solo recibe un Uint8Array: no conoce cómo se generó.
//
// Sesgo inductivo declarado: los bits de índice NO observados en el entrenamiento no influyen (principio de
// parsimonia). Las representaciones con ese sesgo se verifican contra continuación y contra índices lejanos.

import * as zlib from "zlib"
import { gammaBits } from "./bits"

export interface Rep {
  readonly kind: string
  readonly costBits: number
  eval(n: number): number
  prepare?(maxN: number): void          // precomputa una tabla hasta maxN (acelera eval secuencial/prefijos)
}
export interface SolveOut { fired: boolean; rep: Rep | null }
const NO: SolveOut = { fired: false, rep: null }

// ── S1: afín sobre GF(2) en los bits de n ──────────────────────────────────────────────────────
export const solveGf2Affine = (y: Uint8Array): SolveOut => {
  const N = y.length, K = Math.floor(Math.log2(N))
  if (K < 2) return NO
  const c0 = y[0]!, col = new Uint8Array(K)
  for (let i = 0; i < K; i++) col[i] = y[1 << i]! ^ c0
  const pred = (n: number): number => { let v = c0; for (let i = 0; i < K; i++) if ((n >>> i) & 1) v ^= col[i]!; return v }
  for (let t = 0; t < 256; t++) { const n = (Math.imul(t + 1, 2654435761) >>> 0) % N; if (pred(n) !== y[n]) return NO } // propiedad
  for (let n = 0; n < N; n++) if (pred(n) !== y[n]) return { fired: true, rep: null }
  return { fired: true, rep: { kind: "gf2-affine", costBits: 8 * K + 8 + gammaBits(K), eval: (n) => pred(n & ((1 << K) - 1)) } }
}

// ── S2: polinomio módulo 256 (base binomial; coeficientes = diferencias finitas) ─────────────
export const solvePolyMod256 = (y: Uint8Array): SolveOut => {
  const W = Math.min(y.length, 2048)
  let cur = Array.from(y.subarray(0, W)), k = -1
  const coef: number[] = []
  for (let d = 0; d <= 12; d++) {
    if (cur.every((v) => v === 0)) { k = d; break }
    coef.push(cur[0]!)
    const nx = new Array<number>(cur.length - 1)
    for (let i = 0; i < nx.length; i++) nx[i] = (cur[i + 1]! - cur[i]!) & 255
    cur = nx
  }
  if (k < 0) return NO                                                                          // propiedad
  let all = Int32Array.from(y)
  for (let d = 0; d < k; d++) { const nx = new Int32Array(all.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = (all[i + 1]! - all[i]!) & 255; all = nx }
  for (const v of all) if (v !== 0) return { fired: true, rep: null }
  let table: Uint8Array | null = null
  const evalBig = (n: number): number => {
    let acc = 0n, c = 1n; const nb = BigInt(n)
    for (let j = 0; j < k; j++) { acc += BigInt(coef[j]!) * c; c = (c * (nb - BigInt(j))) / BigInt(j + 1) }
    return Number(acc & 255n)
  }
  return {
    fired: true,
    rep: {
      kind: "poly-mod256", costBits: 8 * k + gammaBits(k),
      eval: (n) => (table && n < table.length ? table[n]! : evalBig(n)),
      prepare: (maxN) => {
        const t = new Uint8Array(maxN + 1), d = coef.slice()
        for (let n = 0; n <= maxN; n++) { t[n] = k === 0 ? 0 : d[0]!; for (let j = 0; j < k - 1; j++) d[j] = (d[j]! + d[j + 1]!) & 255 }
        table = t
      },
    },
  }
}

// ── S3: afín desplazada ((a·n+b) mod 2^32 >> s) & 255  — secuencia tipo Beatty/Sturmian ────────
// Propiedad: los incrementos mod 256 toman ≤ 2 valores consecutivos. Se estima la pendiente α, y para cada
// desplazamiento s se recorren los enteros a candidatos cerca de α·2^s; la ventana de b se obtiene por
// intersección exacta de intervalos circulares. (La recuperación es EXACTA cuando existe un único a.)
export const solveBeatty = (y: Uint8Array): SolveOut => {
  const N = y.length
  if (N < 64) return NO
  const cnt = new Uint32Array(256)
  for (let n = 0; n < N - 1; n++) cnt[(y[n + 1]! - y[n]!) & 255]++
  const vals: number[] = []; for (let v = 0; v < 256; v++) if (cnt[v]) vals.push(v)
  if (vals.length > 2) return NO
  let q: number, frac: number
  if (vals.length === 1) { q = vals[0]!; frac = 0 }
  else {
    const [v1, v2] = vals as [number, number]
    if (((v2 - v1) & 255) === 1) { q = v1; frac = cnt[v2]! / (N - 1) }
    else if (((v1 - v2) & 255) === 1) { q = v2; frac = cnt[v1]! / (N - 1) }
    else return NO
  }                                                                                              // propiedad
  const alpha = q + frac, tol = 3 / N
  const check = (a: number, b: number, s: number): boolean => { for (let n = 0; n < N; n++) if (((((Math.imul(a, n) + b) >>> 0) >>> s) & 255) !== y[n]) return false; return true }
  for (let s = 0; s <= 24; s++) {
    const M = 2 ** (s + 8), W = 2 ** s
    const aLo = Math.floor((alpha - tol) * W), aHi = Math.ceil((alpha + tol) * W)
    if (aHi - aLo > 20000) continue
    for (let a = aLo; a <= aHi; a++) {
      const aM = ((a % M) + M) % M
      const L0 = y[0]! * W
      let lo = 0, hi = W, ok = true
      for (let n = 1; n < N && ok; n++) {
        const c = (aM * n) % M
        const t = (((y[n]! * W - c) % M) + M) % M
        let r = (((t - L0) % M) + M) % M
        if (r >= M - W) r -= M
        lo = Math.max(lo, r); hi = Math.min(hi, r + W)
        if (lo >= hi) ok = false
      }
      if (!ok) continue
      // El entrenamiento solo acota b a la ventana [lo, hi): se elige el CENTRO (mínimo error esperado fuera de muestra).
      const bp = (((L0 + Math.floor((lo + hi - 1) / 2)) % M) + M) % M
      if (!check(aM >>> 0, bp >>> 0, s)) continue
      return { fired: true, rep: { kind: "affine-shifted", costBits: gammaBits(s) + 2 * (s + 8), eval: (n) => (((Math.imul(aM, n) + bp) >>> 0) >>> s) & 255 } }
    }
  }
  return { fired: true, rep: null }
}

// ── S4: forma normal algebraica (ANF) de cada bit de salida como función de los bits de n ───────
// Propiedad: esparsidad (pocos monomios). Reproduce siempre el entrenamiento; solo es válida/compacta si es dispersa.
export const solveAnf = (y: Uint8Array, maxMonomials = 400): SolveOut => {
  const N = y.length, K = Math.round(Math.log2(N))
  if (2 ** K !== N || K < 3) return NO
  const monos: number[][] = []
  let total = 0, cost = 0
  const f = new Uint8Array(N)
  for (let j = 0; j < 8; j++) {
    for (let n = 0; n < N; n++) f[n] = (y[n]! >> j) & 1
    for (let i = 0; i < K; i++) { const bit = 1 << i; for (let n = 0; n < N; n++) if (n & bit) f[n]! ^= f[n ^ bit]! }
    const list: number[] = []
    for (let n = 0; n < N; n++) if (f[n]) list.push(n)
    total += list.length
    if (total > maxMonomials) return NO                                                          // propiedad
    monos.push(list); cost += gammaBits(list.length) + list.length * K
  }
  return {
    fired: true,
    rep: { kind: "anf", costBits: cost, eval: (n) => { let o = 0; for (let j = 0; j < 8; j++) { let b = 0; for (const m of monos[j]!) if ((n & m) === m) b ^= 1; o |= b << j } return o } },
  }
}

export const SOLVERS: ReadonlyArray<readonly [string, (y: Uint8Array) => SolveOut]> = [
  ["gf2", solveGf2Affine], ["poly", solvePolyMod256], ["beatty", solveBeatty], ["anf", (y) => solveAnf(y)],
]

// ── transformaciones reversibles ────────────────────────────────────────────────────────────
const xorDelta = (y: Uint8Array): Uint8Array => { const z = new Uint8Array(y.length); z[0] = y[0]!; for (let i = 1; i < y.length; i++) z[i] = y[i]! ^ y[i - 1]!; return z }
const addDelta = (y: Uint8Array): Uint8Array => { const z = new Uint8Array(y.length); z[0] = y[0]!; for (let i = 1; i < y.length; i++) z[i] = (y[i]! - y[i - 1]!) & 255; return z }
const prefixRep = (inner: Rep, op: "xor" | "add"): Rep => {
  let table: Uint8Array | null = null
  return {
    kind: `${op}-prefix(${inner.kind})`, costBits: inner.costBits + 2,
    prepare: (maxN) => { inner.prepare?.(maxN); const t = new Uint8Array(maxN + 1); let acc = 0; for (let i = 0; i <= maxN; i++) { const v = inner.eval(i); acc = op === "xor" ? acc ^ v : (acc + v) & 255; t[i] = acc } table = t },
    eval: (n) => { if (table && n < table.length) return table[n]!; let acc = 0; for (let i = 0; i <= n; i++) { const v = inner.eval(i); acc = op === "xor" ? acc ^ v : (acc + v) & 255 } return acc },
  }
}

export interface Discovery { rep: Rep | null; transform: string; solver: string; costBits: number; trace: string[]; millis: number }

const bestSolve = (y: Uint8Array, tag: string, trace: string[], threshold: number): { rep: Rep; solver: string } | null => {
  let best: { rep: Rep; solver: string } | null = null
  for (const [name, solve] of SOLVERS) {
    const r = solve(y)
    trace.push(`${tag}:${name}:${r.fired ? "F" : "-"}${r.rep ? "✓" : ""}`)
    if (r.rep && r.rep.costBits < threshold && (!best || r.rep.costBits < best.rep.costBits)) best = { rep: r.rep, solver: name }
  }
  return best
}

/** Descubre un generador f(n) para y. Acepta solo si costBits < 25 % del menor entre brotli-11 y crudo. */
export const discover = (y: Uint8Array): Discovery => {
  const t0 = performance.now()
  const brBits = 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  const threshold = 0.25 * Math.min(brBits, 8 * y.length)
  const trace: string[] = []
  let best: { rep: Rep; transform: string; solver: string } | null = null
  const consider = (rep: Rep | null, transform: string, solver: string) => { if (rep && (!best || rep.costBits < best.rep.costBits)) best = { rep, transform, solver } }

  const direct = bestSolve(y, "id", trace, threshold); if (direct) consider(direct.rep, "id", direct.solver)
  const x = bestSolve(xorDelta(y), "xor", trace, threshold); if (x) consider(prefixRep(x.rep, "xor"), "xor-delta", x.solver)
  const a = bestSolve(addDelta(y), "add", trace, threshold); if (a) consider(prefixRep(a.rep, "add"), "add-delta", a.solver)
  // entrelazado m=2: cada carril se resuelve por separado
  {
    const l0 = new Uint8Array(y.length >> 1), l1 = new Uint8Array(y.length >> 1)
    for (let i = 0; i < l0.length; i++) { l0[i] = y[2 * i]!; l1[i] = y[2 * i + 1]! }
    const s0 = bestSolve(l0, "il0", trace, threshold), s1 = bestSolve(l1, "il1", trace, threshold)
    if (s0 && s1) {
      const rep: Rep = {
        kind: `interleave2(${s0.rep.kind}|${s1.rep.kind})`, costBits: s0.rep.costBits + s1.rep.costBits + 2,
        prepare: (maxN) => { s0.rep.prepare?.(maxN >> 1); s1.rep.prepare?.(maxN >> 1) },
        eval: (n) => ((n & 1) ? s1.rep.eval(n >>> 1) : s0.rep.eval(n >>> 1)),
      }
      if (rep.costBits < threshold) consider(rep, "interleave2", `${s0.solver}|${s1.solver}`)
    }
  }
  const b = best as { rep: Rep; transform: string; solver: string } | null
  return { rep: b ? b.rep : null, transform: b ? b.transform : "-", solver: b ? b.solver : "-", costBits: b ? b.rep.costBits : Infinity, trace, millis: performance.now() - t0 }
}
