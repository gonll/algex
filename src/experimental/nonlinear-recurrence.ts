// PROTOTYPE ONLY — Roadmap 2, Priority 7, not wired into the production encoder.
//
// Detects a small nonlinear recurrence family over GF(256):
//   x[n] = c0 ^ c1*x[n-1] ^ c2*x[n-2] ^ c3*(x[n-1]*x[n-2])
// Nonlinear in the samples, but LINEAR in the unknown coefficients c0..c3, so
// it reduces to solving a 4x4 linear system over GF(256) (Gaussian elimination)
// from the first few samples, then verifying the fit holds exactly against the
// rest of the sequence — exact detection only, per the roadmap's own guidance
// ("do not begin with approximate nonlinear fitting").
//
// See scripts/bench-nonlinear-feasibility.ts for the verdict on whether this
// finds anything useful beyond the existing linear (Berlekamp-Massey) search.

import { gfMul, gfAdd, gfInv } from "../utils/gf256"

// Solve A*c = b over GF(256) via Gaussian elimination with pivoting.
// A is n x n, b is length n. Returns c (length n) or null if singular.
const solveGF256 = (A: readonly (readonly number[])[], b: readonly number[]): number[] | null => {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]!])

  for (let col = 0; col < n; col++) {
    let pivotRow = -1
    for (let r = col; r < n; r++) if (M[r]![col] !== 0) { pivotRow = r; break }
    if (pivotRow === -1) return null

    const tmp = M[col]!; M[col] = M[pivotRow]!; M[pivotRow] = tmp

    const invPivot = gfInv(M[col]![col]!)
    for (let c = col; c <= n; c++) M[col]![c] = gfMul(M[col]![c]!, invPivot)

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r]![col]!
      if (factor === 0) continue
      for (let c = col; c <= n; c++) M[r]![c] = gfAdd(M[r]![c]!, gfMul(factor, M[col]![c]!))
    }
  }
  return M.map(row => row[n]!)
}

export interface NonlinearOrder2Result {
  readonly coeffs: readonly [number, number, number, number]  // c0, c1, c2, c3
}

const feature = (seq: Uint8Array, i: number): [number, number, number, number] =>
  [1, seq[i - 1]!, seq[i - 2]!, gfMul(seq[i - 1]!, seq[i - 2]!)]

const evalAt = (coeffs: readonly number[], f: readonly number[]): number => {
  let acc = 0
  for (let k = 0; k < coeffs.length; k++) acc = gfAdd(acc, gfMul(coeffs[k]!, f[k]!))
  return acc
}

// Detect x[n] = c0 ^ c1*x[n-1] ^ c2*x[n-2] ^ c3*(x[n-1]*x[n-2]) as an EXACT
// recurrence (zero mismatches) covering the whole sequence. Returns null if no
// such fit exists (including when the system is singular, or the sequence is
// too short to both fit and verify).
export const findNonlinearOrder2 = (seq: Uint8Array): NonlinearOrder2Result | null => {
  const n = seq.length
  if (n < 8) return null

  const A: number[][] = []
  const b: number[] = []
  for (let k = 0; k < 4; k++) {
    const i = 2 + k
    A.push(feature(seq, i))
    b.push(seq[i]!)
  }

  const c = solveGF256(A, b)
  if (!c) return null

  for (let i = 2; i < n; i++) {
    if (evalAt(c, feature(seq, i)) !== seq[i]) return null
  }

  return { coeffs: [c[0]!, c[1]!, c[2]!, c[3]!] }
}
