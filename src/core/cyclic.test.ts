import { describe, it, expect } from "vitest"
import { findApproxCyclic } from "./cyclic"

// Deterministic LCG — no Math.random() per project testing conventions.
const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

const tile = (cycle: number[], n: number): Uint8Array => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = cycle[i % cycle.length]!
  return out
}

// Corrupt `count` positions of `buf`, chosen by `positions`, with values from a
// deterministic RNG that always flips to a *different* byte.
const corruptAt = (buf: Uint8Array, positions: number[], rng: () => number): Uint8Array => {
  const out = new Uint8Array(buf)
  for (const p of positions) out[p] = (out[p]! ^ (1 + Math.floor(rng() * 255))) & 0xff
  return out
}

const reconstruct = (r: { cycle: Uint8Array; residual: Uint8Array }): Uint8Array =>
  Uint8Array.from(r.residual, (x, i) => x ^ r.cycle[i % r.cycle.length]!)

describe("findApproxCyclic", () => {
  it("finds a perfect period with zero mismatches", () => {
    const buf = tile([17, 201, 5, 233, 88, 42, 156], 700)
    const r = findApproxCyclic(buf)
    expect(r).not.toBeNull()
    expect(r!.mismatches).toBe(0)
    expect(r!.cycle.length).toBe(7)
    expect(reconstruct(r!)).toEqual(buf)
  })

  it("recovers the template from a single one-byte corruption", () => {
    const clean = tile([9, 88, 200, 15], 400)
    const buf = corruptAt(clean, [123], lcg(1))
    const r = findApproxCyclic(buf)
    expect(r).not.toBeNull()
    expect(r!.cycle.length).toBe(4)
    expect(Array.from(r!.cycle)).toEqual([9, 88, 200, 15])
    expect(r!.mismatches).toBe(1)
    expect(reconstruct(r!)).toEqual(buf)
  })

  it.each([0.01, 0.05, 0.10, 0.20])("round-trips exactly at %s corruption rate", rate => {
    const period = 11
    const clean = tile([3, 250, 61, 8, 199, 40, 5, 172, 91, 6, 233], 2200)
    const rng = lcg(Math.floor(rate * 1000) + 7)
    const positions: number[] = []
    for (let i = 0; i < clean.length; i++) if (rng() < rate) positions.push(i)
    const buf = corruptAt(clean, positions, lcg(99))

    const r = findApproxCyclic(buf)
    expect(r).not.toBeNull()
    expect(r!.cycle.length).toBe(period)
    expect(reconstruct(r!)).toEqual(buf)
  })

  it("is not biased toward the first cycle — recovers the template even when cycle 0 is corrupted", () => {
    const template = [4, 44, 4, 44, 200]
    const clean = tile(template, 500)
    // Corrupt every byte of the FIRST repeat only — naive seq.slice(0, P) would
    // adopt the corrupted first cycle verbatim; majority voting must not.
    const buf = corruptAt(clean, [0, 1, 2, 3, 4], lcg(2))
    const r = findApproxCyclic(buf)
    expect(r).not.toBeNull()
    expect(Array.from(r!.cycle)).toEqual(template)
    expect(reconstruct(r!)).toEqual(buf)
  })

  it("picks the period that yields the smallest actual encoding among several plausible periods", () => {
    // Period 4 data is also trivially "period 8, 12, ..." — the search must not
    // settle on a larger multiple just because it also satisfies periodicity.
    const buf = tile([1, 2, 3, 4], 800)
    const r = findApproxCyclic(buf)
    expect(r).not.toBeNull()
    expect(r!.cycle.length).toBe(4)
  })

  it("returns null for a buffer too short to search", () => {
    expect(findApproxCyclic(new Uint8Array(6))).toBeNull()
  })

  it("handles a length not divisible by the period", () => {
    const buf = tile([5, 6, 7], 731)  // 731 % 3 !== 0
    const r = findApproxCyclic(buf)
    expect(r).not.toBeNull()
    expect(r!.cycle.length).toBe(3)
    expect(reconstruct(r!)).toEqual(buf)
  })

  it("finds a period near the configured search cap", () => {
    const period = 100
    const cycle = Array.from({ length: period }, (_, i) => (i * 37 + 5) & 0xff)
    const buf = tile(cycle, period * 4)
    const r = findApproxCyclic(buf, 100)
    expect(r).not.toBeNull()
    expect(r!.cycle.length).toBe(period)
    expect(reconstruct(r!)).toEqual(buf)
  })

  it("rejects incompressible random data (or returns something that still round-trips)", () => {
    const rng = lcg(1234)
    const buf = Uint8Array.from({ length: 600 }, () => Math.floor(rng() * 256))
    const r = findApproxCyclic(buf)
    if (r) expect(reconstruct(r)).toEqual(buf)  // if a period slips through, it must still be correct
  })

  it("dense residual (period 1-like, heavily corrupted) still reconstructs exactly", () => {
    const clean = tile([250], 300)
    const rng = lcg(5)
    const buf = Uint8Array.from(clean, (v) => rng() < 0.3 ? (v ^ (1 + Math.floor(rng() * 255))) & 0xff : v)
    const r = findApproxCyclic(buf)
    if (r) expect(reconstruct(r)).toEqual(buf)
  })
})
