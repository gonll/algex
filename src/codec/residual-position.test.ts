// Roadmap 2, Priority 2 integration: bitmap and RLE residuals compete inside
// the full encode/decode pipeline, not just at the sparse.ts unit level.

import { describe, it, expect } from "vitest"
import { gfMul } from "../utils/gf256"
import { encode } from "./encoder"
import { serialize, deserialize } from "./format"
import { decode } from "./decoder"

const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

describe("Priority 2: bitmap/RLE residual positions through the full pipeline", () => {
  it("round-trips a moderate-density noisy LFSR (bitmap's target range)", () => {
    const n = 4096
    const buf = new Uint8Array(n)
    buf[0] = 1
    for (let i = 1; i < n; i++) buf[i] = gfMul(3, buf[i - 1]!)
    const rng = lcg(7)
    for (let i = 0; i < n; i++) if (rng() < 0.45) buf[i] = (buf[i]! ^ (1 + Math.floor(rng() * 255))) & 0xff

    const file = encode(buf)
    const wire = serialize(file)
    expect(decode(deserialize(wire))).toEqual(buf)
  })

  it("round-trips a burst-corrupted LFSR (RLE's target case)", () => {
    const n = 4096
    const buf = new Uint8Array(n)
    buf[0] = 1
    for (let i = 1; i < n; i++) buf[i] = gfMul(3, buf[i - 1]!)
    // One contiguous burst of corruption instead of scattered noise.
    for (let i = 1000; i < 1150; i++) buf[i] = (buf[i]! ^ 0xff) & 0xff

    const file = encode(buf)
    const wire = serialize(file)
    expect(decode(deserialize(wire))).toEqual(buf)
  })

  it("still round-trips ordinary sparse noise (existing Rice/split territory)", () => {
    const n = 4096
    const buf = new Uint8Array(n)
    buf[0] = 1
    for (let i = 1; i < n; i++) buf[i] = gfMul(3, buf[i - 1]!)
    const rng = lcg(3)
    for (let i = 0; i < n; i++) if (rng() < 0.02) buf[i] = (buf[i]! ^ (1 + Math.floor(rng() * 255))) & 0xff

    const file = encode(buf)
    const wire = serialize(file)
    expect(decode(deserialize(wire))).toEqual(buf)
  })
})
