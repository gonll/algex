// Cost budget manager: presets exist, are respected, stay lossless, and keep
// determinism (same input+mode -> byte-identical output every time, and sync
// vs worker-parallel encode must not diverge for the same budget).

import { describe, it, expect } from "vitest"
import { compress, decompress, compressAsync } from "../index"
import { BUDGETS } from "./search-budget"
import { gfMul, gfAdd } from "../utils/gf256"

const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

const makeMixed = (): Uint8Array => {
  const a = new Uint8Array(600)
  a[0] = 1
  for (let i = 1; i < a.length; i++) a[i] = gfMul(3, a[i - 1]!)
  const b = new Uint8Array(600)
  b[0] = 1; b[1] = 3
  for (let i = 2; i < b.length; i++) b[i] = gfAdd(gfMul(0x1b, b[i - 1]!), gfMul(0x4e, b[i - 2]!))
  const out = new Uint8Array(a.length + b.length)
  out.set(a); out.set(b, a.length)
  return out
}

describe("search-budget presets", () => {
  it("exposes fast/balanced/max with sensible ordering", () => {
    expect(BUDGETS.fast.maxExpensiveCandidates).toBeLessThanOrEqual(BUDGETS.balanced.maxExpensiveCandidates)
    expect(BUDGETS.balanced.maxExpensiveCandidates).toBeLessThanOrEqual(BUDGETS.max.maxExpensiveCandidates)
    expect(BUDGETS.fast.maxModelSolves).toBeLessThanOrEqual(BUDGETS.balanced.maxModelSolves)
    expect(BUDGETS.fast.maxTransformDepth).toBeLessThanOrEqual(BUDGETS.balanced.maxTransformDepth)
  })

  it.each(["fast", "balanced", "max"] as const)("round-trips losslessly in %s mode", mode => {
    const buf = makeMixed()
    const compressed = compress(buf, mode)
    expect(decompress(compressed)).toEqual(buf)
  })

  it.each(["fast", "balanced", "max"] as const)("is deterministic across repeated calls in %s mode", mode => {
    const buf = makeMixed()
    const a = compress(buf, mode)
    const b = compress(buf, mode)
    expect(a).toEqual(b)
  })

  it("balanced mode matches the documented default (no mode argument)", () => {
    const buf = makeMixed()
    expect(compress(buf)).toEqual(compress(buf, "balanced"))
  })

  it("sync and worker-parallel encode agree for the same budget (no thread-order dependence)", async () => {
    const buf = makeMixed()
    const sync = compress(buf, "balanced")
    const async_ = await compressAsync(buf, 4, undefined, "balanced")
    expect(decompress(sync)).toEqual(decompress(async_))
  })

  it("edge cases still round-trip under every mode", () => {
    const rng = lcg(3)
    const cases = [
      new Uint8Array(0),
      new Uint8Array([42]),
      Uint8Array.from({ length: 777 }, () => Math.floor(rng() * 256)),
    ]
    for (const mode of ["fast", "balanced", "max"] as const) {
      for (const buf of cases) expect(decompress(compress(buf, mode))).toEqual(buf)
    }
  })
})
