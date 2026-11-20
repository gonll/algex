// AST/DAG serializable, determinista y evaluable de expresiones sobre secuencias de bytes (laboratorio, exp. 10).
//
// Un Node denota una función n -> byte. `evalVec(node, N)` la evalúa en [0, N). `encode`/`decode` son un
// formato de bits exacto: el costo en bits de una representación ES la longitud de su codificación (no el texto).
// Convenciones: los bits de índice >= K se ignoran (sesgo inductivo declarado en synth.ts).

export type Node =
  | { t: "poly"; coef: number[] }                              // Σ coef[j]·C(n,j) mod 256 (base binomial)
  | { t: "gf2"; K: number; c0: number; col: number[] }          // c0 ^ XOR_{bit i de n} col[i]
  | { t: "beatty"; a: number; b: number; s: number }            // ((a·n+b) mod 2^32 >> s) & 255
  | { t: "anf"; K: number; monos: number[][] }                  // 8 planos, cada uno una lista de máscaras de monomio
  | { t: "table"; data: number[] }                              // data[n mod len] (len potencia de 2)
  | { t: "xorc"; k: number; x: Node }
  | { t: "addc"; k: number; x: Node }
  | { t: "mulo"; m: number; x: Node }                           // m impar
  | { t: "rotl"; r: number; x: Node }
  | { t: "baff"; rows: number[]; k: number; x: Node }           // bit i de salida = paridad(rows[i] & x) ^ bit i de k
  | { t: "prefix"; op: "xor" | "add"; x: Node }
  | { t: "il2"; a: Node; b: Node }
  | { t: "bin"; op: "xor" | "add"; a: Node; b: Node }
  | { t: "idx"; bits: number; rows: number[]; k: number; x: Node } // n' = (rows·(n mod 2^bits)) ^ k  (rows.length bits de salida); salida = x(n')

const PAR = new Uint8Array(256); for (let i = 0; i < 256; i++) { let v = i, p = 0; while (v) { p ^= v & 1; v >>= 1 } PAR[i] = p }
const par32 = (v: number): number => { v ^= v >>> 16; v ^= v >>> 8; return PAR[v & 255]! }
const rotl8 = (v: number, r: number): number => ((v << r) | (v >> (8 - r))) & 255

export const evalVec = (node: Node, N: number): Uint8Array => {
  const out = new Uint8Array(N)
  switch (node.t) {
    case "poly": {
      const k = node.coef.length; if (k === 0) return out
      const d = node.coef.slice()
      for (let n = 0; n < N; n++) { out[n] = d[0]!; for (let j = 0; j < k - 1; j++) d[j] = (d[j]! + d[j + 1]!) & 255 }
      return out
    }
    case "gf2": {
      const S = 1 << node.K, v = new Uint8Array(S); v[0] = node.c0
      for (let n = 1; n < S; n++) v[n] = v[n & (n - 1)]! ^ node.col[31 - Math.clz32(n & -n)]!
      for (let n = 0; n < N; n++) out[n] = v[n & (S - 1)]!
      return out
    }
    case "beatty": { for (let n = 0; n < N; n++) out[n] = (((Math.imul(node.a, n) + node.b) >>> 0) >>> node.s) & 255; return out }
    case "anf": {
      const S = 1 << node.K, tab = new Uint8Array(S), f = new Uint8Array(S)
      for (let j = 0; j < 8; j++) {
        f.fill(0); for (const m of node.monos[j]!) f[m] = 1
        for (let i = 0; i < node.K; i++) { const b = 1 << i; for (let n = 0; n < S; n++) if (n & b) f[n]! ^= f[n ^ b]! }
        for (let n = 0; n < S; n++) tab[n]! |= f[n]! << j
      }
      for (let n = 0; n < N; n++) out[n] = tab[n & (S - 1)]!
      return out
    }
    case "table": { const L = node.data.length; for (let n = 0; n < N; n++) out[n] = node.data[n & (L - 1)]!; return out }
    case "xorc": { const v = evalVec(node.x, N); for (let n = 0; n < N; n++) out[n] = v[n]! ^ node.k; return out }
    case "addc": { const v = evalVec(node.x, N); for (let n = 0; n < N; n++) out[n] = (v[n]! + node.k) & 255; return out }
    case "mulo": { const v = evalVec(node.x, N); for (let n = 0; n < N; n++) out[n] = (v[n]! * node.m) & 255; return out }
    case "rotl": { const v = evalVec(node.x, N); for (let n = 0; n < N; n++) out[n] = rotl8(v[n]!, node.r); return out }
    case "baff": {
      const v = evalVec(node.x, N), lut = new Uint8Array(256)
      for (let x = 0; x < 256; x++) { let o = 0; for (let i = 0; i < 8; i++) o |= (PAR[x & node.rows[i]!]! ^ ((node.k >> i) & 1)) << i; lut[x] = o }
      for (let n = 0; n < N; n++) out[n] = lut[v[n]!]!
      return out
    }
    case "prefix": { const v = evalVec(node.x, N); let acc = 0; for (let n = 0; n < N; n++) { acc = node.op === "xor" ? acc ^ v[n]! : (acc + v[n]!) & 255; out[n] = acc } return out }
    case "il2": { const h = (N + 1) >> 1, a = evalVec(node.a, h), b = evalVec(node.b, h); for (let n = 0; n < N; n++) out[n] = (n & 1) ? b[n >> 1]! : a[n >> 1]!; return out }
    case "bin": { const a = evalVec(node.a, N), b = evalVec(node.b, N); for (let n = 0; n < N; n++) out[n] = node.op === "xor" ? a[n]! ^ b[n]! : (a[n]! + b[n]!) & 255; return out }
    case "idx": {
      const r = node.rows.length, S = 1 << node.bits, inner = evalVec(node.x, 1 << r)
      const colm = new Array<number>(node.bits).fill(0)
      for (let j = 0; j < r; j++) for (let i = 0; i < node.bits; i++) if ((node.rows[j]! >> i) & 1) colm[i]! |= 1 << j
      const T = new Uint32Array(S); T[0] = node.k
      for (let n = 1; n < S; n++) T[n] = T[n & (n - 1)]! ^ colm[31 - Math.clz32(n & -n)]!
      for (let n = 0; n < N; n++) out[n] = inner[T[n & (S - 1)]!]!
      return out
    }
  }
}

// ── codificación en bits ────────────────────────────────────────────────────────────────────────
class BW {
  bits: number[] = []
  w(v: number, n: number) { for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) % 2) }
  gamma(v: number) { const x = v + 1, L = Math.floor(Math.log2(x)); this.w(0, L); this.w(x, L + 1) }
}
class BR {
  p = 0
  constructor(public bits: number[]) {}
  r(n: number) { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + this.bits[this.p++]!; return v }
  gamma() { let L = 0; while (this.bits[this.p] === 0) { L++; this.p++ } return this.r(L + 1) - 1 }
}
const TAGS = ["poly", "gf2", "beatty", "anf", "table", "xorc", "addc", "mulo", "rotl", "baff", "prefix", "il2", "bin", "idx"] as const

const enc = (node: Node, w: BW): void => {
  w.w(TAGS.indexOf(node.t), 4)
  switch (node.t) {
    case "poly": w.gamma(node.coef.length); for (const c of node.coef) w.w(c, 8); break
    case "gf2": w.w(node.K, 5); w.w(node.c0, 8); for (let i = 0; i < node.K; i++) w.w(node.col[i]!, 8); break
    case "beatty": w.w(node.s, 5); w.w(node.a, node.s + 8); w.w(node.b, node.s + 8); break
    case "anf": w.w(node.K, 5); for (let j = 0; j < 8; j++) { w.gamma(node.monos[j]!.length); for (const m of node.monos[j]!) w.w(m, node.K) } break
    case "table": w.gamma(Math.log2(node.data.length)); for (const v of node.data) w.w(v, 8); break
    case "xorc": case "addc": w.w(node.k, 8); enc(node.x, w); break
    case "mulo": w.w((node.m - 1) >> 1, 7); enc(node.x, w); break
    case "rotl": w.w(node.r, 3); enc(node.x, w); break
    case "baff": for (let i = 0; i < 8; i++) w.w(node.rows[i]!, 8); w.w(node.k, 8); enc(node.x, w); break
    case "prefix": w.w(node.op === "xor" ? 0 : 1, 1); enc(node.x, w); break
    case "il2": enc(node.a, w); enc(node.b, w); break
    case "bin": w.w(node.op === "xor" ? 0 : 1, 1); enc(node.a, w); enc(node.b, w); break
    case "idx": { w.w(node.bits, 5); w.w(node.rows.length, 5); for (const m of node.rows) w.w(m, node.bits); w.w(node.k, node.rows.length); enc(node.x, w); break }
  }
}
const dec = (r: BR): Node => {
  const t = TAGS[r.r(4)]!
  switch (t) {
    case "poly": { const k = r.gamma(), coef: number[] = []; for (let i = 0; i < k; i++) coef.push(r.r(8)); return { t, coef } }
    case "gf2": { const K = r.r(5), c0 = r.r(8), col: number[] = []; for (let i = 0; i < K; i++) col.push(r.r(8)); return { t, K, c0, col } }
    case "beatty": { const s = r.r(5), a = r.r(s + 8), b = r.r(s + 8); return { t, a, b, s } }
    case "anf": { const K = r.r(5), monos: number[][] = []; for (let j = 0; j < 8; j++) { const c = r.gamma(), l: number[] = []; for (let i = 0; i < c; i++) l.push(r.r(K)); monos.push(l) } return { t, K, monos } }
    case "table": { const L = 2 ** r.gamma(), data: number[] = []; for (let i = 0; i < L; i++) data.push(r.r(8)); return { t, data } }
    case "xorc": case "addc": { const k = r.r(8); return { t, k, x: dec(r) } }
    case "mulo": { const m = r.r(7) * 2 + 1; return { t, m, x: dec(r) } }
    case "rotl": { const rr = r.r(3); return { t, r: rr, x: dec(r) } }
    case "baff": { const rows: number[] = []; for (let i = 0; i < 8; i++) rows.push(r.r(8)); const k = r.r(8); return { t, rows, k, x: dec(r) } }
    case "prefix": { const op = r.r(1) === 0 ? "xor" : "add"; return { t, op, x: dec(r) } }
    case "il2": { const a = dec(r); return { t, a, b: dec(r) } }
    case "bin": { const op = r.r(1) === 0 ? "xor" : "add"; const a = dec(r); return { t, op, a, b: dec(r) } }
    case "idx": { const bits = r.r(5), n = r.r(5), rows: number[] = []; for (let i = 0; i < n; i++) rows.push(r.r(bits)); const k = r.r(n); return { t, bits, rows, k, x: dec(r) } }
  }
}
export const encode = (node: Node): number[] => { const w = new BW(); enc(node, w); return w.bits }
export const decode = (bits: number[]): Node => dec(new BR(bits))
/** Costo real: longitud en bits de la codificación (sin el encabezado de longitud de los datos, ~2·log2 N bits). */
export const costBits = (node: Node): number => encode(node).length

/** Simplificación: idx(idx(x)) -> idx único (producto de matrices GF(2)). */
export const simplify = (node: Node): Node => {
  switch (node.t) {
    case "idx": {
      const x = simplify(node.x)
      if (x.t === "idx") {
        // n' = A1 n ^ k1 ; n'' = A2 n' ^ k2  =>  rows2'[j] = XOR_{i en rows2[j]} rows1[i];  k' = A2 k1 ^ k2
        const rows = x.rows.map((m2) => { let acc = 0; for (let i = 0; i < node.rows.length; i++) if ((m2 >> i) & 1) acc ^= node.rows[i]!; return acc })
        let k = x.k; for (let j = 0; j < x.rows.length; j++) if (par32(x.rows[j]! & node.k)) k ^= 1 << j
        return { t: "idx", bits: node.bits, rows, k, x: x.x }
      }
      return { ...node, x }
    }
    case "xorc": case "addc": case "mulo": case "rotl": case "baff": case "prefix": return { ...node, x: simplify(node.x) } as Node
    case "il2": return { t: "il2", a: simplify(node.a), b: simplify(node.b) }
    case "bin": return { ...node, a: simplify(node.a), b: simplify(node.b) }
    default: return node
  }
}
export const show = (node: Node): string => {
  switch (node.t) {
    case "poly": return `poly(${node.coef.length})`
    case "gf2": return `gf2(K=${node.K})`
    case "beatty": return `beatty(s=${node.s})`
    case "anf": return `anf(${node.monos.reduce((a, l) => a + l.length, 0)})`
    case "table": return `tabla(${node.data.length})`
    case "idx": return `idx(${node.bits}→${node.rows.length})∘${show(node.x)}`
    case "prefix": return `prefix-${node.op}∘${show(node.x)}`
    case "il2": return `il2(${show(node.a)}|${show(node.b)})`
    case "bin": return `${node.op}(${show(node.a)},${show(node.b)})`
    default: return `${node.t}∘${show(node.x)}`
  }
}
