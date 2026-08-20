// Priority 6: bounded transform composition — specifically the
// "interleave/bitplane → delta → LFSR" composition, which the existing
// architecture didn't cover (delta→interleave and delta→bitplane already
// existed via encodeChunkInner's own delta wrapping; bitplane→cyclic already
// existed via encodeChunkCore's Priority-2 approx-cyclic candidate — the one
// gap was a lane/plane that only reveals structure after ITS OWN delta pass).

import { describe, it, expect } from "vitest"
import { gfMul } from "../utils/gf256"
import { mergeInterleave } from "../utils/interleave"
import { encode } from "./encoder"
import { serialize, deserialize } from "./format"
import { decode } from "./decoder"
import { compress, decompress } from "../index"

describe("Priority 6: interleave → delta-per-lane → LFSR composition", () => {
  it("delta-wraps an arithmetic-counter lane while leaving the LFSR lane inline", () => {
    const n = 300
    const lane0 = new Uint8Array(n)
    lane0[0] = 5
    for (let i = 1; i < n; i++) lane0[i] = gfMul(3, lane0[i - 1]!)

    // A step-3 arithmetic counter: not directly GF(2^8)-linear (high raw BM
    // complexity, and its period exceeds the exact-cyclic search's window at
    // this length), but ADD-delta collapses it to a constant byte stream.
    const lane1 = new Uint8Array(n)
    for (let i = 0; i < n; i++) lane1[i] = (i * 3) & 0xff

    const interleaved = mergeInterleave([lane0, lane1], 2)
    const file = encode(interleaved)

    expect(file.chunks.length).toBe(1)
    const chunk = file.chunks[0]!
    expect(chunk.kind).toBe("interleave")
    if (chunk.kind !== "interleave") throw new Error("unreachable")

    const laneKinds = chunk.lanes.map(l => l.kind)
    expect(laneKinds).toContain("lfsr")
    expect(laneKinds).toContain("delta")

    // Genuinely smaller than raw, and lossless round-trip through decode and
    // through the full wire format.
    const wire = serialize(file)
    expect(wire.length).toBeLessThan(interleaved.length / 2)
    expect(decode(file)).toEqual(interleaved)
    expect(decode(deserialize(wire))).toEqual(interleaved)
  })

  it("round-trips through the full compress/decompress pipeline", () => {
    const n = 400
    const lane0 = new Uint8Array(n)
    lane0[0] = 1; lane0[1] = 3
    for (let i = 2; i < n; i++) lane0[i] = gfMul(2, lane0[i - 1]!) ^ gfMul(5, lane0[i - 2]!)

    const lane1 = new Uint8Array(n)
    for (let i = 0; i < n; i++) lane1[i] = (i * 7 + 11) & 0xff

    const lane2 = new Uint8Array(n)
    for (let i = 0; i < n; i++) lane2[i] = (i * 13) & 0xff

    const interleaved = mergeInterleave([lane0, lane1, lane2], 3)
    const compressed = compress(interleaved)
    expect(decompress(compressed)).toEqual(interleaved)
  })

  it("still round-trips ordinary (non-composed) interleaved and bitplane data", () => {
    const n = 256
    const lane0 = new Uint8Array(n)
    lane0[0] = 1
    for (let i = 1; i < n; i++) lane0[i] = gfMul(3, lane0[i - 1]!)
    const lane1 = new Uint8Array(n)
    lane1[0] = 1
    for (let i = 1; i < n; i++) lane1[i] = gfMul(7, lane1[i - 1]!)

    const interleaved = mergeInterleave([lane0, lane1], 2)
    const compressed = compress(interleaved)
    expect(decompress(compressed)).toEqual(interleaved)
  })
})
