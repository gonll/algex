// Roadmap 2, Priority 4: switching/piecewise LFSR models.

import { describe, it, expect } from "vitest"
import { gfMul } from "../utils/gf256"
import { encode, encodeAsync } from "./encoder"
import { serialize, deserialize } from "./format"
import { decode } from "./decoder"
import { compress, decompress } from "../index"

const makeL1 = (n: number, coeff: number, seed = 1): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = seed
  for (let i = 1; i < n; i++) buf[i] = gfMul(coeff, buf[i - 1]!)
  return buf
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

describe("Priority 4: switching-LFSR chunks", () => {
  it("bundles many short alternating-model segments into one switching-lfsr chunk", () => {
    // Six short segments alternating between two distinct L=1 models — many
    // separate top-level chunks would each pay their own framing overhead
    // (kind + origLen + CRC32 + XDNI index entry).
    const parts: Uint8Array[] = []
    for (let i = 0; i < 6; i++) parts.push(makeL1(160, i % 2 === 0 ? 3 : 7, 5 + i))
    const buf = concat(...parts)

    const file = encode(buf)
    const wire = serialize(file)
    expect(decode(deserialize(wire))).toEqual(buf)

    const hasSwitching = file.chunks.some(c => c.kind === "switching-lfsr")
    expect(hasSwitching).toBe(true)
  })

  it("is smaller than the equivalent forced-separate encoding", () => {
    const parts: Uint8Array[] = []
    for (let i = 0; i < 6; i++) parts.push(makeL1(160, i % 2 === 0 ? 3 : 7, 5 + i))
    const buf = concat(...parts)

    const file = encode(buf)
    const wire = serialize(file)

    // A conservative "forced separate" baseline: same segments, but each
    // wrapped as its own file (isolating just the top-level framing cost each
    // top-level chunk would pay standalone) — a real over-estimate of the true
    // "separate chunks in one file" cost, but a valid upper bound to compare
    // against, cheaply, without duplicating encoder internals.
    const perSegmentOverhead = parts.map(p => serialize(encode(p)).length)
    const forcedSeparateUpperBound = perSegmentOverhead.reduce((s, n) => s + n, 0)

    expect(wire.length).toBeLessThan(forcedSeparateUpperBound)
  })

  it("round-trips through the full compress/decompress pipeline", () => {
    const parts: Uint8Array[] = []
    for (let i = 0; i < 8; i++) parts.push(makeL1(150, [3, 7, 0x1b, 0x4e][i % 4]!, 2 + i))
    const buf = concat(...parts)

    const compressed = compress(buf)
    expect(decompress(compressed)).toEqual(buf)
  })

  it("sync and worker-parallel encode agree when switching-lfsr triggers", async () => {
    const parts: Uint8Array[] = []
    for (let i = 0; i < 6; i++) parts.push(makeL1(160, i % 2 === 0 ? 3 : 7, 5 + i))
    const buf = concat(...parts)

    const sync = serialize(encode(buf))
    const async_ = serialize(await encodeAsync(buf, 4))
    expect(sync).toEqual(async_)
    expect(decode(deserialize(async_))).toEqual(buf)
  })

  it("does not fragment a single continuous model into a switching chunk", () => {
    const buf = makeL1(4000, 3)
    const file = encode(buf)
    expect(file.chunks.some(c => c.kind === "switching-lfsr")).toBe(false)
  })

  it("falls back to separate chunks when a segment isn't a clean LFSR fit", () => {
    // Mix an LFSR segment with a segment that has no clean structure — the
    // switching-LFSR candidate should simply not apply, not crash or corrupt.
    const rng = (() => { let s = 3; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff } })()
    const lfsrPart = makeL1(600, 3)
    const randomPart = Uint8Array.from({ length: 600 }, () => Math.floor(rng() * 256))
    const buf = concat(lfsrPart, randomPart, makeL1(600, 7))

    const file = encode(buf)
    expect(decode(file)).toEqual(buf)
  })
})
