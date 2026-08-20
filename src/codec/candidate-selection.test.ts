// Priority 1: actual-size best-candidate selection.
//
// Before this change, encodeChunkInner returned the first representation that
// beat raw (LFSR paths tried before cyclic), even when a later candidate was
// smaller in actual serialized bytes. These tests use fixed, deterministic
// buffers — no Math.random() — so results are reproducible.

import { describe, it, expect } from "vitest"
import { encode } from "./encoder"
import { serialize } from "./format"
import { decode } from "./decoder"

const tile = (cycle: number[], n: number): Uint8Array => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = cycle[i % cycle.length]!
  return out
}

// Deterministic LCG — avoids Math.random() per project testing conventions.
const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

describe("Priority 1: actual-size best-candidate selection", () => {
  it("prefers cyclic over LFSR when cyclic is the smaller actual representation", () => {
    // This period-7 cycle also loosely fits an approximate LFSR (with residual),
    // which the old first-fit encoder picked (61 wire bytes) without ever
    // comparing it to the much smaller exact cyclic representation (51 bytes).
    const cycle = [17, 201, 5, 233, 88, 42, 156]
    const buf = tile(cycle, 2048)

    const file = encode(buf)
    expect(file.chunks.length).toBe(1)
    expect(file.chunks[0]!.kind).toBe("cyclic")

    const wire = serialize(file)
    expect(wire.length).toBe(51)          // was 61 under first-fit selection
    expect(decode(file)).toEqual(buf)
  })

  it("random data is not forced into a worse structural representation", () => {
    const rng = lcg(42)
    const buf = Uint8Array.from({ length: 2048 }, () => Math.floor(rng() * 256))

    const file = encode(buf)
    for (const c of file.chunks) expect(c.kind).toBe("raw")

    const wire = serialize(file)
    expect(wire.length).toBeLessThanOrEqual(Math.ceil(buf.length * 1.05))
    expect(decode(file)).toEqual(buf)
  })
})
