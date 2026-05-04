// Polynomial arithmetic over GF(2^8): evaluation, root finding, and LFSR factoring.
//
// The minimal polynomial of an LFSR with coeffs [c₁..cL] is:
//   f(x) = x^L + c₁x^(L-1) + ... + c_L  (descending order: [1, c₁, ..., c_L])
//
// Its roots in GF(2^8) are the characteristic roots of the recurrence.  If f splits
// into L distinct linear factors, the sequence is a sum of L independent geometric
// sequences — each encodable as a separate L=1 LFSR.

import { GFElem, LFSR } from "../types"
import { gfAdd, gfMul } from "../utils/gf256"

// Evaluate polynomial p (descending coefficients) at x via Horner's method.  O(deg).
export const evalPoly = (p: GFElem[], x: GFElem): GFElem =>
  p.reduce((acc, c) => gfAdd(gfMul(acc, x), c), 0)

// LFSR minimal polynomial in descending form: [1, c₁, c₂, ..., c_L]
export const lfsrMinPoly = ({ coeffs, length }: LFSR): GFElem[] =>
  [1, ...coeffs.slice(0, length)]

// Find all roots of p in GF(2^8) by trial evaluation.  O(256 · deg).
export const findRoots = (p: GFElem[]): GFElem[] => {
  const roots: GFElem[] = []
  for (let x = 0; x < 256; x++) if (evalPoly(p, x) === 0) roots.push(x)
  return roots
}

// Divide p by the linear factor (x + r) — equivalent to (x − r) in GF(2^8) — via
// synthetic division.  Assumes r is a verified root; no remainder check.
const divByLinear = (p: GFElem[], r: GFElem): GFElem[] => {
  const q: GFElem[] = new Array(p.length - 1)
  q[0] = p[0]!
  for (let k = 1; k < p.length - 1; k++) q[k] = gfAdd(p[k]!, gfMul(r, q[k - 1]!))
  return q
}

// Reconstruct the LFSR minimal polynomial from its roots — the inverse of factorRoots.
// Computes ∏ (x + αᵢ) over GF(2^8) (x + r = x − r since char 2) and returns the
// LFSR connection polynomial in DESCENDING form: [1, c₁, c₂, ..., c_L].
export const polyFromRoots = (roots: GFElem[]): GFElem[] => {
  let poly: GFElem[] = [1]
  for (const root of roots) {
    const next = new Uint8Array(poly.length + 1)
    for (let i = 0; i < poly.length; i++) {
      next[i]     ^= poly[i]!                  // x · poly[i]
      next[i + 1] ^= gfMul(root, poly[i]!)     // root · poly[i]
    }
    poly = Array.from(next) as GFElem[]
  }
  return poly  // [1, c₁, ..., c_L]
}

// Attempt to fully factor the LFSR minimal polynomial into distinct linear factors.
// Returns the L roots [α₁..αL] when successful, or null if any irreducible factor
// of degree ≥ 2 remains (can't represent as independent L=1 components).
export const factorRoots = (lfsr: LFSR): GFElem[] | null => {
  if (lfsr.length === 0) return []
  if (lfsr.length === 1) return [lfsr.coeffs[0]!]

  let poly = lfsrMinPoly(lfsr)
  const roots: GFElem[] = []

  while (poly.length > 1) {
    const r = findRoots(poly)[0]
    if (r === undefined) return null  // irreducible factor — cannot split fully
    roots.push(r)
    poly = divByLinear(poly, r)
  }

  // Reject if any root is repeated (linear independence breaks down)
  return new Set(roots).size === roots.length ? roots : null
}
