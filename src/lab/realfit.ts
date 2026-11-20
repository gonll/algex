// Adaptador de columnas reales al sintetizador congelado (exp. 13). No modifica compose.ts ni decimate.ts.
// Un plano (bytes de una columna) se busca en el prefijo 2^floor(log2 n) con la capa de diezmado y el MISMO criterio de
// aceptación del exp. 12; el modelo hallado se VERIFICA contra el plano completo: ajustar solo el prefijo es un falso positivo.
import * as zlib from "zlib"
import { discoverCompose } from "./compose"
import { evalVec, simplify, Node } from "./ast"
import { lane, laneLen, shareLanes, gammaBits, Shared } from "./decimate"
import { Column, planes, columnBytes } from "./columns"

export const MODS = [1, 2, 4, 8, 16]
export const brotli = (y: Uint8Array): number => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length

export interface PlaneFit {
  accepted: boolean            // algún módulo con descripción < 25 % de min(brotli, crudo) sobre el prefijo
  exactFull: boolean           // el modelo reproduce los n bytes del plano
  m: number; bits: number      // módulo elegido y bits de la descripción compartida (∞ si no hay)
  ms: number; work: number
  trained: number; n: number   // bytes usados para buscar / bytes totales (n - trained son datos no vistos)
}
export const fitPlane = (plane: Uint8Array, mods: number[] = MODS, depth = 2): PlaneFit => {
  const n = plane.length, L0 = 2 ** Math.floor(Math.log2(n))
  let best: { m: number; bits: number; sh: Shared } | null = null, ms = 0, work = 0
  for (const m of mods) {
    const Lm = laneLen(L0, m); if (Lm < 256) continue
    const nodes: Node[] = []; let ok = true
    for (let c = 0; c < m; c++) {
      const t0 = Date.now(), r = discoverCompose(lane(plane, m, c, Lm), { maxDepth: depth }); ms += Date.now() - t0
      if (!r || !(r.cost < 0.25 * 8 * Lm)) { ok = false; break }
      work += r.work; nodes.push(simplify(r.node))
    }
    if (!ok) continue
    const sh = shareLanes(nodes)
    if (sh.bits < 0.25 * Math.min(brotli(plane.subarray(0, m * Lm)), 8 * m * Lm) && (!best || sh.bits < best.bits)) best = { m, bits: sh.bits, sh }
  }
  if (!best) return { accepted: false, exactFull: false, m: 0, bits: Infinity, ms, work, trained: L0, n }
  let exact = true
  for (let c = 0; c < best.m && exact; c++) {
    const K = Math.ceil((n - c) / best.m), v = evalVec(best.sh.rebuild(c), K)
    for (let i = 0; i < K; i++) if (v[i] !== plane[best.m * i + c]) { exact = false; break }
  }
  return { accepted: true, exactFull: exact, m: best.m, bits: best.bits, ms, work, trained: L0, n }
}

// ── baselines ──────────────────────────────────────────────────────────────────────────────────
const concat = (ps: Uint8Array[]): Uint8Array => { const o = new Uint8Array(ps.reduce((s, p) => s + p.length, 0)); let k = 0; for (const p of ps) { o.set(p, k); k += p.length } return o }
const planesOf = (vals: bigint[], w: number): Uint8Array[] => {
  const out = Array.from({ length: w }, () => new Uint8Array(vals.length))
  for (let i = 0; i < vals.length; i++) { let v = vals[i]!; for (let p = 0; p < w; p++) { out[p]![i] = Number(v & 255n); v >>= 8n } }
  return out
}
const diffMod = (v: bigint[], M: bigint): bigint[] => v.map((x, i) => (((x - (i ? v[i - 1]! : 0n)) % M) + M) % M)
export interface Baselines { b0: number; b1: number; b2: number; b3: number }
export const baselines = (c: Column): Baselines => {
  const M = 1n << BigInt(8 * c.w), d1 = diffMod(c.values, M), d2 = diffMod(d1, M)
  return { b0: brotli(columnBytes(c)), b1: brotli(concat(planes(c))), b2: brotli(concat(planesOf(d1, c.w))), b3: brotli(concat(planesOf(d2, c.w))) }
}
/** Costo del sintetizador para una columna: metadatos + por plano min(modelo verificado, brotli del plano) + 1 bit. */
export const columnSynthCost = (c: Column, fits: PlaneFit[], pl: Uint8Array[]): number => {
  let bits = 64 + gammaBits(c.n) + gammaBits(c.w)
  fits.forEach((f, p) => { bits += 1 + Math.min(f.accepted && f.exactFull ? f.bits : Infinity, brotli(pl[p]!)) })
  return bits
}

// ── predictor + residual estadístico (análisis, no componente) ─────────────────────────────────
const solve = (A: number[][], b: number[]): number[] => {   // eliminación gaussiana
  const n = b.length, M = A.map((r, i) => [...r, b[i]!])
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r]![i]!) > Math.abs(M[p]![i]!)) p = r
    ;[M[i], M[p]] = [M[p]!, M[i]!]
    const d = M[i]![i]! || 1e-12
    for (let r = i + 1; r < n; r++) { const f = M[r]![i]! / d; for (let k = i; k <= n; k++) M[r]![k]! -= f * M[i]![k]! }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) { let s = M[i]![n]!; for (let k = i + 1; k < n; k++) s -= M[i]![k]! * x[k]!; x[i] = s / (M[i]![i]! || 1e-12) }
  return x
}
const polyFit = (y: number[], deg: number): number[] => {       // sobre t = i / n (bien condicionado)
  const n = y.length, A = Array.from({ length: deg + 1 }, () => new Array<number>(deg + 1).fill(0)), b = new Array<number>(deg + 1).fill(0)
  for (let i = 0; i < n; i++) { const t = i / n; for (let a = 0; a <= deg; a++) { b[a]! += y[i]! * t ** a; for (let k = 0; k <= deg; k++) A[a]![k]! += t ** (a + k) } }
  return solve(A, b)
}
const zig = (r: number): number => (r >= 0 ? 2 * r : -2 * r - 1)
/** Bits de: coeficientes (float64) + residual en zigzag por planos con brotli. Mínimo sobre lineal, cuadrático y lineal por tramos de 256. Solo w ≤ 6. */
export const predictorResidual = (c: Column): { bits: number; kind: string } | null => {
  if (c.w > 6) return null
  const y = c.values.map((v) => Number(v)), n = y.length, W = c.w + 1
  const cost = (pred: number[], coefBits: number): number => {
    const r = pred.map((p, i) => zig(y[i]! - Math.round(p))), planesR = Array.from({ length: W }, () => new Uint8Array(n))
    for (let i = 0; i < n; i++) { let v = r[i]!; for (let p = 0; p < W; p++) { planesR[p]![i] = v % 256; v = Math.floor(v / 256) } }
    return 64 + gammaBits(n) + gammaBits(c.w) + coefBits + brotli(concat(planesR))
  }
  const evalP = (co: number[], i: number, n0: number) => { const t = i / n0; let s = 0; for (let a = 0; a < co.length; a++) s += co[a]! * t ** a; return s }
  let best = { bits: Infinity, kind: "" }
  for (const deg of [1, 2]) { const co = polyFit(y, deg); const b = cost(y.map((_, i) => evalP(co, i, n)), 64 * (deg + 1)); if (b < best.bits) best = { bits: b, kind: deg === 1 ? "lineal" : "cuadrático" } }
  const S = 256, pred: number[] = []; let segs = 0
  for (let s0 = 0; s0 < n; s0 += S) { const seg = y.slice(s0, s0 + S), co = seg.length > 2 ? polyFit(seg, 1) : [seg[0] ?? 0, 0]; segs++; for (let i = 0; i < seg.length; i++) pred.push(evalP(co, i, seg.length)) }
  const bp = cost(pred, 128 * segs); if (bp < best.bits) best = { bits: bp, kind: "lineal por tramos" }
  return best
}

// ── diagnóstico ────────────────────────────────────────────────────────────────────────────────
export interface Diag { distinct: number; distinctDeltas: number; monotone: number; deltaEntropy: number; maxRun: number }
export const diagnose = (c: Column): Diag => {
  const v = c.values, n = v.length, deltas = new Map<bigint, number>(), vals = new Set<bigint>()
  let up = 0, run = 1, maxRun = 1
  for (let i = 0; i < n; i++) {
    vals.add(v[i]!)
    if (i) { const d = v[i]! - v[i - 1]!; deltas.set(d, (deltas.get(d) ?? 0) + 1); if (d >= 0n) up++; if (v[i] === v[i - 1]) { run++; if (run > maxRun) maxRun = run } else run = 1 }
  }
  let H = 0; for (const k of deltas.values()) { const p = k / (n - 1); H -= p * Math.log2(p) }
  return { distinct: vals.size, distinctDeltas: deltas.size, monotone: up / (n - 1), deltaEntropy: H, maxRun }
}
