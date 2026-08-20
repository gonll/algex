// Priority 3 integration: split position/value streams (kind=5) compete against
// the interleaved formats (kind=2/3/4) on ACTUAL compressed size, not raw size —
// kind=5 is always a couple bytes larger raw, so this only pays off once a
// downstream compressor is applied. This mirrors format.ts's computeWireResidual
// without needing to export its internals.

import { describe, it, expect } from "vitest"
import { deflateRawSync, brotliCompressSync, constants } from "zlib"
import { packResidual, packSplitResidual, unpackResidual } from "../utils/sparse"

const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

const compressedSize = (packed: Uint8Array): number => {
  const d = deflateRawSync(packed, { level: 9 }).length + 5
  const b = brotliCompressSync(packed, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length + 5
  const p = packed.length + 1
  return Math.min(d, b, p)
}

describe("Priority 3: split residual streams beat interleaved after compression", () => {
  it("wins when positions are irregular but values are constant/repetitive", () => {
    // Interleaving "irregular gap, 0xAB" pairs prevents a general-purpose
    // compressor from collapsing the constant value into one long run; splitting
    // the streams exposes that run directly.
    const rng = lcg(5)
    const residual = new Uint8Array(8192)
    let pos = 0
    while (pos < residual.length) {
      pos += 3 + Math.floor(rng() * 40)
      if (pos < residual.length) residual[pos] = 0xab
    }

    const primarySize = compressedSize(packResidual(residual))
    const split = packSplitResidual(residual)
    expect(split).not.toBeNull()
    const splitSize = compressedSize(split!)

    expect(splitSize).toBeLessThan(primarySize)

    const [decoded, consumed] = unpackResidual(split!, 0, residual.length)
    expect(consumed).toBe(split!.length)
    expect(decoded).toEqual(residual)
  })

  it("does not regress a tiny sparse residual — declines to even try below the pair-count floor", () => {
    const residual = new Uint8Array(64)
    residual[5] = 1
    // Below MIN_PAIRS_FOR_SPLIT there's no plausible win, so the encoder never
    // pays for a second compression pass — packResidual's kind=4 wins by default.
    expect(packSplitResidual(residual)).toBeNull()
  })
})
