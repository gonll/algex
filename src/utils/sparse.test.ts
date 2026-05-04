import { describe, it, expect } from "vitest"
import { packResidual, packedResidualSize, unpackResidual } from "./sparse"

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
