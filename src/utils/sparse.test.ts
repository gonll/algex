import { describe, it, expect } from "vitest"
import { packResidual, packedResidualSize, unpackResidual, packSplitResidual, packRiceResidual } from "./sparse"

const roundtrip = (residual: Uint8Array) => {
  const packed = packResidual(residual)
  const [decoded, consumed] = unpackResidual(packed, 0, residual.length)
  expect(consumed).toBe(packed.length)
  if (residual.every((b) => b === 0)) {
    expect(decoded.length).toBe(0)
  } else {
    expect(Array.from(decoded)).toEqual(Array.from(residual))
  }
}

describe("packResidual / unpackResidual", () => {
  it("all-zero → empty (kind=0, 1 byte)", () => {
    const packed = packResidual(new Uint8Array(512))
    expect(packed).toEqual(new Uint8Array([0]))
  })

  it("all-zero roundtrip returns empty", () => {
    roundtrip(new Uint8Array(512))
  })

  it("dense when >33% non-zero", () => {
    const r = Uint8Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0x55 : 0))
    const packed = packResidual(r)
    // kind=1 (dense) or kind=4 (VarInt) — whichever is smaller; must roundtrip
    expect(packed[0] === 1 || packed[0] === 4).toBe(true)
    roundtrip(r)
  })

  it("sparse when <33% non-zero", () => {
    const r = new Uint8Array(512)
    r[10] = 0xab; r[200] = 0x12; r[400] = 0xff  // only 3 non-zeros
    const packed = packResidual(r)
    // kind=2 (uint16 sparse) or kind=4 (VarInt) — whichever is smaller; must roundtrip
    expect(packed[0] === 2 || packed[0] === 4).toBe(true)
    expect(packed.length).toBeLessThan(20)
    roundtrip(r)
  })

  it("sparse roundtrip preserves exact non-zero positions", () => {
    const r = new Uint8Array(1024)
    r[0] = 1; r[511] = 2; r[1023] = 3
    roundtrip(r)
  })

  it("large sparse (kind=3) roundtrip with positions > 65535", () => {
    const r = new Uint8Array(131072)  // 128KB
    r[0] = 1; r[65536] = 2; r[131071] = 3
    const packed = packResidual(r)
    expect(packed[0]).toBe(3)  // kind=sparse32 (maxPos > 65535)
    roundtrip(r)
  })

  it("packedResidualSize matches actual packed length", () => {
    for (const r of [new Uint8Array(512), new Uint8Array(100).fill(5), (() => { const a = new Uint8Array(512); a[42]=1; return a })()]) {
      expect(packedResidualSize(r)).toBe(packResidual(r).length)
    }
  })
})

// Priority 3: split position/value streams (kind=5)
describe("packSplitResidual (kind=5)", () => {
  const roundtripSplit = (residual: Uint8Array) => {
    const packed = packSplitResidual(residual)
    expect(packed).not.toBeNull()
    expect(packed![0]).toBe(5)
    const [decoded, consumed] = unpackResidual(packed!, 0, residual.length)
    expect(consumed).toBe(packed!.length)
    expect(Array.from(decoded)).toEqual(Array.from(residual))
  }

  it("returns null for all-zero residual", () => {
    expect(packSplitResidual(new Uint8Array(256))).toBeNull()
  })

  it("returns null when the largest position exceeds uint16 range", () => {
    const r = new Uint8Array(70000)
    for (let i = 0; i < 10; i++) r[69990 + i] = i + 1  // 10 pairs — past MIN_PAIRS_FOR_SPLIT
    expect(packSplitResidual(r)).toBeNull()
  })

  it("returns null below the minimum pair count — not enough structure for a header to pay off", () => {
    const r = new Uint8Array(64)
    r[0] = 0xff; r[10] = 0x11  // 2 pairs
    expect(packSplitResidual(r)).toBeNull()
  })

  it("round-trips a handful of sparse non-zero bytes", () => {
    const r = new Uint8Array(1024)
    const positions = [3, 9, 90, 150, 300, 500, 700, 1000]
    positions.forEach((p, i) => { r[p] = 0x11 * (i + 1) })
    roundtripSplit(r)
  })

  it("round-trips a dense (mostly non-zero) residual", () => {
    const r = Uint8Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 0 : (i * 7) & 0xff))
    roundtripSplit(r)
  })

  it("packed size accounts for the extra 2-byte posStreamLen vs kind=4", () => {
    const r = new Uint8Array(2048)
    const positions = [10, 20, 30, 40, 50, 60, 70, 80]
    for (const p of positions) r[p] = 1
    const split = packSplitResidual(r)!
    // Same content as kind=4 would encode, plus the 2-byte length prefix.
    expect(split.length).toBe(1 + 2 + 2 + 8 /* 8 one-byte varint gaps */ + 8 /* 8 values */)
  })

  // The wire FORMAT itself must still support small pair counts correctly —
  // only the production packer (packSplitResidual) declines to emit them.
  it("decodes a hand-built kind=5 buffer with a single pair", () => {
    const buf = new Uint8Array([5, 0, 1, 0, 1, 5, 0xaa])  // pairCount=1 (BE), posStreamLen=1 (BE), gap=5, val=0xaa
    const [decoded] = unpackResidual(buf, 0, 64)
    expect(decoded[5]).toBe(0xaa)
    expect(decoded.filter(b => b !== 0).length).toBe(1)
  })
})

// Priority 4: Rice/Golomb-coded positions (kind=6)
describe("packRiceResidual (kind=6)", () => {
  const lcg = (seed: number) => {
    let s = seed
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  }

  const roundtripRice = (residual: Uint8Array) => {
    const packed = packRiceResidual(residual)
    expect(packed).not.toBeNull()
    expect(packed![0]).toBe(6)
    const [decoded, consumed] = unpackResidual(packed!, 0, residual.length)
    expect(consumed).toBe(packed!.length)
    expect(decoded).toEqual(residual)
  }

  it("returns null below the minimum pair count", () => {
    const r = new Uint8Array(64)
    r[0] = 1; r[10] = 2
    expect(packRiceResidual(r)).toBeNull()
  })

  it("returns null for all-zero residual", () => {
    expect(packRiceResidual(new Uint8Array(512))).toBeNull()
  })

  it("round-trips a zero gap (two adjacent error positions)", () => {
    const r = new Uint8Array(256)
    for (const p of [0, 1, 50, 51, 52, 100, 150, 200, 201, 250]) r[p] = (p % 250) + 1
    roundtripRice(r)
  })

  it("round-trips the very first position", () => {
    const r = new Uint8Array(256)
    r[0] = 0xff
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8]) r[p] = p
    roundtripRice(r)
  })

  it("round-trips a large gap", () => {
    const r = new Uint8Array(60000)
    for (const p of [0, 1, 2, 3, 4, 5, 6, 59999]) r[p] = 7
    roundtripRice(r)
  })

  it("round-trips an empty residual gracefully via unpack of a hand-built kind=6 buffer", () => {
    // pairCount=0 is a degenerate but well-formed kind=6 buffer.
    const buf = new Uint8Array([6, 0, 0, 3, 0, 0, 0, 0])  // pairCount=0, k=3, posBits=0
    const [decoded, consumed] = unpackResidual(buf, 0, 64)
    expect(consumed).toBe(8)
    expect(decoded.every(b => b === 0)).toBe(true)
  })

  it("dense residual (period-1-like) still round-trips", () => {
    const r = Uint8Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0xab : 0))
    roundtripRice(r)
  })

  it.each([0.001, 0.005, 0.01, 0.02, 0.05, 0.10, 0.20, 0.30])(
    "beats or matches VarInt (kind=4) at %s error rate",
    rate => {
      const rng = lcg(Math.round(rate * 100000) + 1)
      const n = 8192
      const residual = new Uint8Array(n)
      for (let i = 0; i < n; i++) if (rng() < rate) residual[i] = 1 + Math.floor(rng() * 255)

      const nonZero = residual.filter(b => b !== 0).length
      if (nonZero < 8) return  // below MIN_PAIRS floor for both split and Rice — nothing to compare

      const varint = packResidual(residual)  // may itself pick dense/sparse32 instead of kind=4 — that's fine, it's the baseline
      const rice = packRiceResidual(residual)
      expect(rice).not.toBeNull()

      // Rice must never be worse than the baseline in this comparison by more
      // than a couple of header bytes — and should usually win outright for a
      // uniformly-scattered (geometric-gap) error distribution.
      expect(rice!.length).toBeLessThanOrEqual(varint.length + 4)

      const [decoded] = unpackResidual(rice!, 0, residual.length)
      expect(decoded).toEqual(residual)
    }
  )

  it("wins outright at a representative mid error rate", () => {
    const rng = lcg(777)
    const n = 8192
    const residual = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (rng() < 0.02) residual[i] = 1 + Math.floor(rng() * 255)

    const varint = packResidual(residual)
    const rice = packRiceResidual(residual)!
    expect(rice.length).toBeLessThan(varint.length)
  })
})
