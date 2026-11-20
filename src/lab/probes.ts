// Sondas de propiedades baratas sobre una secuencia de bytes (laboratorio, experimento 10).
// Cada sonda responde "¿qué estructura observable tiene y; sobrevive a una capa externa?" sin conocer el generador.

/** Menor período potencia de 2 (<= maxP) tal que y[n] == y[n & (P-1)] para todo n; 0 si no hay. */
export const pow2Period = (y: Uint8Array, maxP = 4096): number => {
  for (let P = 1; P <= Math.min(maxP, y.length >> 1); P <<= 1) {
    let ok = true
    for (let n = P; n < y.length && ok; n++) if (y[n] !== y[n & (P - 1)]) ok = false
    if (ok) return P
  }
  return 0
}

/** Orden de diferencia finita mod 256 que anula la secuencia (<= maxD); -1 si no. */
export const polyDegree = (y: Uint8Array, maxD = 12): number => {
  let cur = Int32Array.from(y.subarray(0, Math.min(y.length, 2048)))
  for (let d = 0; d <= maxD; d++) {
    let z = true; for (const v of cur) if (v !== 0) { z = false; break }
    if (z) return d
    const nx = new Int32Array(cur.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = (cur[i + 1]! - cur[i]!) & 255
    cur = nx
  }
  return -1
}

/** Cantidad de incrementos distintos mod 256 (tipo Beatty => <= 2 consecutivos). */
export const incrementAlphabet = (y: Uint8Array): number => {
  const s = new Uint8Array(256); let c = 0
  for (let n = 0; n + 1 < y.length; n++) { const d = (y[n + 1]! - y[n]!) & 255; if (!s[d]) { s[d] = 1; c++ } }
  return c
}
export const xorAlphabet = (y: Uint8Array): number => {
  const s = new Uint8Array(256); let c = 0
  for (let n = 0; n + 1 < y.length; n++) { const d = y[n + 1]! ^ y[n]!; if (!s[d]) { s[d] = 1; c++ } }
  return c
}
export const distinctValues = (y: Uint8Array): number => { const s = new Uint8Array(256); let c = 0; for (const v of y) if (!s[v]) { s[v] = 1; c++ } return c }

/** ¿y es afín sobre GF(2) en los bits de n (n < 2^K)? */
export const isGf2Affine = (y: Uint8Array): boolean => {
  const K = Math.floor(Math.log2(y.length)); if (K < 2) return false
  const c0 = y[0]!, col: number[] = []; for (let i = 0; i < K; i++) col.push(y[1 << i]! ^ c0)
  for (let n = 0; n < y.length; n++) { let v = c0; for (let i = 0; i < K; i++) if ((n >>> i) & 1) v ^= col[i]!; if (v !== y[n]) return false }
  return true
}

/** Total de monomios ANF (8 planos) si N es potencia de 2; -1 si no. */
export const anfWeight = (y: Uint8Array): number => {
  const N = y.length, K = Math.round(Math.log2(N)); if (2 ** K !== N) return -1
  const f = new Uint8Array(N); let total = 0
  for (let j = 0; j < 8; j++) {
    for (let n = 0; n < N; n++) f[n] = (y[n]! >> j) & 1
    for (let i = 0; i < K; i++) { const b = 1 << i; for (let n = 0; n < N; n++) if (n & b) f[n]! ^= f[n ^ b]! }
    for (let n = 0; n < N; n++) total += f[n]!
  }
  return total
}

/** Dimensión del grupo de simetrías XOR G={v: y(n^v)=y(n) ∀n} (y.length potencia de 2); devuelve la base reducida. */
export const xorSymmetry = (y: Uint8Array, cap = 4096): { dim: number; basis: number[] } => {
  const N = y.length, els: number[] = [0]
  let cand = 0
  for (let v = 1; v < N; v++) {
    if (y[v] !== y[0]) continue
    if (++cand > cap) return { dim: -1, basis: [] }
    let ok = true; for (let n = 1; n < N && ok; n++) if (y[n ^ v] !== y[n]) ok = false
    if (ok) els.push(v)
  }
  // base: eliminación gaussiana con el bit alto como pivote; luego se reduce (RREF)
  const basis: number[] = []
  for (const e of els) { let x = e; for (const b of basis) x = Math.min(x, x ^ b); if (x) basis.push(x) }
  basis.sort((a, b) => b - a)
  for (let i = 0; i < basis.length; i++) { const hi = 31 - Math.clz32(basis[i]!); for (let j = 0; j < basis.length; j++) if (j !== i && (basis[j]! >> hi) & 1) basis[j]! ^= basis[i]! }
  return { dim: basis.length, basis }
}

/** Por plano de bits j (0..7): menor k tal que el plano depende solo de n mod 2^k (requiere período 256); 9 si ninguno. */
export const planeDependenceLevels = (y: Uint8Array): number[] => {
  const out: number[] = []
  for (let j = 0; j < 8; j++) {
    let lvl = 9
    for (let k = 0; k <= 8; k++) {
      const m = (1 << k) - 1; let ok = true
      for (let n = 0; n < Math.min(y.length, 256) && ok; n++) if (((y[n]! >> j) & 1) !== ((y[n & m]! >> j) & 1)) ok = false
      if (ok) { lvl = k; break }
    }
    out.push(lvl)
  }
  return out
}
