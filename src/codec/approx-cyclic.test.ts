// Priority 2 integration: approximate cyclic chunks through the full encode/decode
// and serialize/deserialize pipeline (not just the core.ts search function).

import { describe, it, expect } from "vitest"
import { encode } from "./encoder"
import { serialize, deserialize } from "./format"
import { decode } from "./decoder"

const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

const tile = (cycle: number[], n: number): Uint8Array => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = cycle[i % cycle.length]!
  return out
}

const corrupt = (buf: Uint8Array, rate: number, rng: () => number): Uint8Array =>
  Uint8Array.from(buf, v => (rng() < rate ? (v ^ (1 + Math.floor(rng() * 255))) & 0xff : v))

describe("Priority 2: approximate cyclic through the full pipeline", () => {
  it("selects approx-cyclic for periodic data with sparse corruption and round-trips through wire format", () => {
    const clean = tile([65, 66, 67, 65, 66, 67, 88, 66, 67], 3000)  // "ABCABCXBC..." style
    const buf = corrupt(clean, 0.03, lcg(11))

    const file = encode(buf)
    expect(file.chunks.some(c => c.kind === "approx-cyclic")).toBe(true)

    const wire = serialize(file)
    const restoredFile = deserialize(wire)
    expect(decode(restoredFile)).toEqual(buf)
  })

  it("compresses noisy periodic data better than storing it raw", () => {
    const clean = tile(Array.from({ length: 23 }, (_, i) => (i * 17 + 3) & 0xff), 4096)
    const buf = corrupt(clean, 0.02, lcg(23))

    const file = encode(buf)
    const wire = serialize(file)
    expect(wire.length).toBeLessThan(buf.length * 0.5)
    expect(decode(deserialize(wire))).toEqual(buf)
  })

  it("still round-trips when no periodicity exists (falls back correctly)", () => {
    const rng = lcg(7)
    const buf = Uint8Array.from({ length: 2048 }, () => Math.floor(rng() * 256))
    const file = encode(buf)
    expect(decode(deserialize(serialize(file)))).toEqual(buf)
  })
})
