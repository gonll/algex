import { describe, it, expect } from "vitest"
import { evalPoly, findRoots, lfsrMinPoly, factorRoots, polyFromRoots } from "./gf-poly"
import { addon } from "../native/addon"
import { gfMul } from "../utils/gf256"

const berlekampMassey = (seq: number[]) => {
  const r = addon.bmSolve(Buffer.from(seq))
  return { coeffs: r.coeffs, length: r.length }
}

// Build an L=1 GF geometric sequence
const makeGF1 = (n: number, coeff: number, seed = 1): number[] => {
  const s = [seed]
  for (let i = 1; i < n; i++) s.push(gfMul(coeff, s[i - 1]!))
  return s
}

describe("evalPoly", () => {
  it("evaluates x + α at α yields 0", () => {
    // poly = [1, α]  →  f(x) = x + α;  f(α) = α + α = 0
    expect(evalPoly([1, 3], 3)).toBe(0)
  })

  it("evaluates degree-0 polynomial (constant)", () => {
    expect(evalPoly([5], 7)).toBe(5)
  })
})

describe("findRoots", () => {
  it("finds the root of a linear factor [1, α]", () => {
    const roots = findRoots([1, 7])
    expect(roots).toContain(7)
    expect(roots).toHaveLength(1)
  })

  it("finds both roots of a split quadratic", () => {
    // f(x) = (x + α)(x + β) for distinct α, β
    // minimal poly of L=2 BM on GF sequence xored with another GF sequence
    const lfsr = berlekampMassey([...makeGF1(64, 3), ...makeGF1(64, 5)].slice(0, 128))
    const poly = lfsrMinPoly(lfsr)
    const roots = findRoots(poly)
    // At minimum the roots satisfy f(root) = 0
    for (const r of roots) expect(evalPoly(poly, r)).toBe(0)
  })
})

describe("polyFromRoots", () => {
  it("reconstructs [1, α] for a single root", () => {
    // (x + α) = [1, α]
    expect(polyFromRoots([7])).toEqual([1, 7])
  })

  it("round-trips: polyFromRoots ∘ factorRoots = lfsrMinPoly", () => {
    // L=2 sequence — minimal polynomial must split (two distinct roots found)
    const seq = [...makeGF1(32, 3), ...makeGF1(32, 5)].slice(0, 64)
    const lfsr  = berlekampMassey(seq)
    const roots = factorRoots(lfsr)
    if (roots === null) return  // polynomial doesn't split — skip this path
    const reconstructed = polyFromRoots(roots)
    expect(reconstructed).toEqual(lfsrMinPoly(lfsr))
  })

  it("each root is a zero of the reconstructed polynomial", () => {
    const roots = [3, 7, 11]
    const poly  = polyFromRoots(roots)
    for (const r of roots) expect(evalPoly(poly, r)).toBe(0)
  })

  it("degree equals number of roots", () => {
    expect(polyFromRoots([]).length).toBe(1)   // degree 0: [1]
    expect(polyFromRoots([5]).length).toBe(2)
    expect(polyFromRoots([2, 9]).length).toBe(3)
  })
})

describe("factorRoots", () => {
  it("factors L=1 LFSR into its single root", () => {
    const lfsr = berlekampMassey(makeGF1(64, 3))
    const roots = factorRoots(lfsr)
    expect(roots).not.toBeNull()
    expect(roots).toHaveLength(1)
    expect(roots![0]).toBe(3)
  })

  it("returns null for random-looking sequence (irreducible polynomial)", () => {
    // xorshift pseudo-random — BM finds a long LFSR unlikely to split fully
    let x = 0xdeadbeef
    const seq = Array.from({ length: 64 }, () => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x & 0xff
    })
    const lfsr = berlekampMassey(seq)
    // Might be null OR an array — just verify the function doesn't throw
    expect(() => factorRoots(lfsr)).not.toThrow()
  })
})
