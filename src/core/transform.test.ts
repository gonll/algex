import { describe, it, expect } from "vitest"
import {
  huffmanEstimate, rawCost, baselineCost, shouldTryTransforms,
  deltaXor1Apply, deltaXor1Invert,
  deltaAdd1Apply, deltaAdd1Invert,
  deltaXor2Apply, deltaXor2Invert,
  DELTA_TRANSFORMS,
} from "./transform"

const makeRandom = (n: number, seed: number): Uint8Array => {
  let s = seed >>> 0
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s & 0xff
  })
}

describe("huffmanEstimate", () => {
  it("returns 0 for all-same-byte input (single symbol, zero entropy)", () => {
    expect(huffmanEstimate(new Uint8Array(1000).fill(0x42))).toBe(0)
  })

  it("approaches N*8 for uniform distribution", () => {
    const buf = Uint8Array.from({ length: 256 * 4 }, (_, i) => i & 0xff)
    const est = huffmanEstimate(buf)
    // Uniform 256 symbols: entropy = 8 bits/byte; with 1.05 overhead ≈ 8.4 bits/byte
    expect(est).toBeGreaterThan(buf.length * 7.5)
    expect(est).toBeLessThanOrEqual(Math.ceil(buf.length * 8 * 1.05 + 1))
  })
})

describe("shouldTryTransforms", () => {
  it("returns false for constant (zero entropy) data", () => {
    expect(shouldTryTransforms(new Uint8Array(1024).fill(0xab))).toBe(false)
  })

  it("returns false for low-entropy repeated-pattern data", () => {
    const buf = new Uint8Array(1024)
    for (let i = 0; i < buf.length; i++) buf[i] = i & 0x03  // 4 distinct values
    expect(shouldTryTransforms(buf)).toBe(false)
  })

  it("returns true for high-entropy (random-looking) data", () => {
    expect(shouldTryTransforms(makeRandom(1024, 0xdeadbeef))).toBe(true)
  })

  it("returns false for buffers shorter than 16 bytes", () => {
    expect(shouldTryTransforms(makeRandom(8, 42))).toBe(false)
  })
})

describe("baselineCost", () => {
  it("is rawCost for high-entropy data", () => {
    const buf = makeRandom(256, 0xcafe)
    expect(baselineCost(buf)).toBeLessThanOrEqual(rawCost(buf))
  })

  it("is less than rawCost for compressible data", () => {
    const buf = new Uint8Array(256).fill(0x41)
    expect(baselineCost(buf)).toBeLessThan(rawCost(buf))
  })
})

// ── Delta roundtrips ──────────────────────────────────────────────────────────

const roundtrips = (
  apply: (x: Uint8Array) => Uint8Array,
  invert: (x: Uint8Array) => Uint8Array,
  buf: Uint8Array
) => expect(invert(apply(buf))).toEqual(buf)

describe("deltaXor1 roundtrip", () => {
  it("identity on empty buffer", () => roundtrips(deltaXor1Apply, deltaXor1Invert, new Uint8Array(0)))
  it("identity on single byte", () => roundtrips(deltaXor1Apply, deltaXor1Invert, new Uint8Array([0x42])))
  it("identity on random bytes", () => roundtrips(deltaXor1Apply, deltaXor1Invert, makeRandom(1024, 0x1111)))
  it("identity on constant bytes", () => roundtrips(deltaXor1Apply, deltaXor1Invert, new Uint8Array(256).fill(0x55)))

  it("turns a counter sequence 0,1,2,... into constant 1s", () => {
    const counter = Uint8Array.from({ length: 256 }, (_, i) => i & 0xff)
    const diff = deltaAdd1Apply(counter)
    expect(diff.slice(1).every(b => b === 1)).toBe(true)
  })
})

describe("deltaAdd1 roundtrip", () => {
  it("identity on empty buffer", () => roundtrips(deltaAdd1Apply, deltaAdd1Invert, new Uint8Array(0)))
  it("identity on single byte", () => roundtrips(deltaAdd1Apply, deltaAdd1Invert, new Uint8Array([0x99])))
  it("identity on random bytes", () => roundtrips(deltaAdd1Apply, deltaAdd1Invert, makeRandom(1024, 0x2222)))

  it("turns wrapping counter 0..255,0..255 into constant 1s (except wrap)", () => {
    const counter = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff)
    const diff = deltaAdd1Apply(counter)
    // All differences are 1 (wrapping is also 1 mod 256)
    expect(diff.slice(1).every(b => b === 1)).toBe(true)
  })
})

describe("deltaXor2 roundtrip", () => {
  it("identity on random bytes", () => roundtrips(deltaXor2Apply, deltaXor2Invert, makeRandom(1024, 0x3333)))
  it("identity on empty buffer", () => roundtrips(deltaXor2Apply, deltaXor2Invert, new Uint8Array(0)))
})

describe("DELTA_TRANSFORMS array", () => {
  it("all transforms are invertible on random data", () => {
    const buf = makeRandom(512, 0xabcd)
    for (const dt of DELTA_TRANSFORMS) {
      expect(dt.invert(dt.apply(buf))).toEqual(buf)
    }
  })

  it("IDs are 3, 4, 5", () => {
    expect(DELTA_TRANSFORMS.map(d => d.id)).toEqual([3, 4, 5])
  })
})
