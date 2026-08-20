import { describe, it, expect } from "vitest"
import { gfMul, gfAdd } from "../utils/gf256"
import { findNonlinearOrder2 } from "./nonlinear-recurrence"

const genNonlinear = (n: number, c0: number, c1: number, c2: number, c3: number, s0 = 1, s1 = 3): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = s0; buf[1] = s1
  for (let i = 2; i < n; i++) {
    buf[i] = c0 ^ gfMul(c1, buf[i - 1]!) ^ gfMul(c2, buf[i - 2]!) ^ gfMul(c3, gfMul(buf[i - 1]!, buf[i - 2]!))
  }
  return buf
}

const genLinear = (n: number, c1: number, c2: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = 1; buf[1] = 3
  for (let i = 2; i < n; i++) buf[i] = gfAdd(gfMul(c1, buf[i - 1]!), gfMul(c2, buf[i - 2]!))
  return buf
}

describe("findNonlinearOrder2 prototype: correctness", () => {
  it("recovers coefficients for a genuine nonlinear recurrence", () => {
    const buf = genNonlinear(200, 0x11, 0x22, 0x33, 0x44)
    const result = findNonlinearOrder2(buf)
    expect(result).not.toBeNull()
    expect(result!.coeffs).toEqual([0x11, 0x22, 0x33, 0x44])
  })

  it("verifies the fit against the WHOLE sequence, not just the fitting samples", () => {
    // Corrupt a byte well past the 4 samples used to solve the system —
    // must be rejected (exact detection only).
    const buf = genNonlinear(200, 0x11, 0x22, 0x33, 0x44)
    buf[150] ^= 0xff
    expect(findNonlinearOrder2(buf)).toBeNull()
  })

  it("also fits a purely linear sequence (c3=0 is a valid solution)", () => {
    const buf = genLinear(200, 0x1b, 0x4e)
    const result = findNonlinearOrder2(buf)
    // Not required to find it (a linear system with only 4 equations from
    // linear data can be singular), but if it does, it must be an honest fit.
    if (result) expect(result.coeffs[3]).toBe(0)
  })

  it("rejects random data", () => {
    let s = 7
    const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    const buf = Uint8Array.from({ length: 200 }, () => Math.floor(rng() * 256))
    expect(findNonlinearOrder2(buf)).toBeNull()
  })

  it("returns null for sequences too short to verify", () => {
    expect(findNonlinearOrder2(new Uint8Array(6))).toBeNull()
  })
})
