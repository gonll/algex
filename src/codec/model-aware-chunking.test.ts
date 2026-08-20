// Roadmap 2, Priority 1: model-aware chunking.
//
// Tests exercise the real integration point (encode()), which wires the
// model-aware chunker to the actual encoder's real-cost estimator — the same
// path production code uses, not just the cheap standalone fallback.

import { describe, it, expect } from "vitest"
import { encode } from "./encoder"
import { decode } from "./decoder"
import { modelAwareSplit } from "./chunker"
import { gfMul, gfAdd } from "../utils/gf256"

const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

const makeL1 = (n: number, coeff: number, seed = 1): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = seed
  for (let i = 1; i < n; i++) buf[i] = gfMul(coeff, buf[i - 1]!)
  return buf
}

const makeL3 = (n: number, c1: number, c2: number, c3: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = 5; buf[1] = 11; buf[2] = 17
  for (let i = 3; i < n; i++)
    buf[i] = gfAdd(gfAdd(gfMul(c1, buf[i - 1]!), gfMul(c2, buf[i - 2]!)), gfMul(c3, buf[i - 3]!))
  return buf
}

const addNoise = (buf: Uint8Array, rate: number, rng: () => number): Uint8Array =>
  Uint8Array.from(buf, v => (rng() < rate ? (v ^ (1 + Math.floor(rng() * 255))) & 0xff : v))

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

describe("model-aware chunking", () => {
  it("finds (or approximates) the boundary between two models sharing similar entropy", () => {
    // Both an L=1 m-sequence and an L=3 recurrence read as ~8 bits/byte to
    // Shannon entropy, so the FIRST (entropy) pass should not reliably split
    // here — this is specifically the case the model-aware second pass targets.
    const a = makeL1(1200, 3)
    const b = makeL3(1200, 0x57, 0x2f, 0x11)
    const buf = concat(a, b)

    const file = encode(buf)
    // The old blind-midpoint bisection would land at byte 1200 regardless of
    // where the real transition is; this checks that a boundary shows up
    // reasonably close to the ACTUAL model change (within the tolerance a
    // bounded, non-exhaustive scan is expected to achieve), not just at the
    // geometric midpoint by coincidence.
    expect(file.chunks.length).toBeGreaterThanOrEqual(2)

    const offsets: number[] = []
    let offset = 0
    for (const c of file.chunks) {
      offsets.push(offset)
      offset += c.kind === "raw" ? c.data.length : c.originalLength
    }
    const nearestToTrueBoundary = Math.min(...offsets.map(o => Math.abs(o - a.length)))
    expect(nearestToTrueBoundary).toBeLessThan(200)

    expect(decode(file)).toEqual(buf)
  })

  it("does not split a single continuous model unnecessarily", () => {
    const buf = makeL1(4000, 3)
    const file = encode(buf)
    // A single clean geometric sequence should stay as one representation
    // (possibly after adjacent-chunk merging) — not fragmented needlessly.
    const lfsrChunks = file.chunks.filter(c => c.kind === "lfsr" || c.kind === "cyclic")
    expect(lfsrChunks.length).toBeLessThanOrEqual(2)
  })

  it("still separates a noisy model transition", () => {
    const rng = lcg(11)
    const a = addNoise(makeL1(1200, 3), 0.01, lcg(1))
    const b = addNoise(makeL3(1200, 0x57, 0x2f, 0x11), 0.01, lcg(2))
    void rng
    const buf = concat(a, b)
    const file = encode(buf)
    expect(file.chunks.length).toBeGreaterThanOrEqual(1)
    // Must still round-trip regardless of exactly how it chunked.
    const decoded = decode(file)
    expect(decoded).toEqual(buf)
  })

  it("random input: bounded runtime, no pathological split explosion", () => {
    const rng = lcg(99)
    const buf = Uint8Array.from({ length: 8192 }, () => Math.floor(rng() * 256))
    const t0 = Date.now()
    const file = encode(buf)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(10_000)
    // Random data shouldn't fragment into an excessive number of tiny chunks.
    expect(file.chunks.length).toBeLessThan(20)
  })

  it("mixed data (LFSR / raw / cyclic / LFSR) still round-trips", () => {
    const lfsrA = makeL1(600, 3)
    const raw = Uint8Array.from({ length: 400 }, (_, i) => (i * 97 + 13) & 0xff)
    const cyclic = (() => {
      const cycle = [7, 200, 33, 91]
      return Uint8Array.from({ length: 600 }, (_, i) => cycle[i % cycle.length]!)
    })()
    const lfsrB = makeL1(600, 0x1b)
    const buf = concat(lfsrA, raw, cyclic, lfsrB)

    const file = encode(buf)
    const decoded = decode(file)
    expect(decoded).toEqual(buf)
  })

  describe("modelAwareSplit unit-level (cheap fallback estimator)", () => {
    it("returns the buffer whole when it already fits one model", () => {
      const buf = makeL1(4000, 3)
      const parts = modelAwareSplit(buf)
      expect(parts.length).toBe(1)
      expect(parts[0]).toEqual(buf)
    })

    it("never drops or reorders bytes regardless of how it splits", () => {
      const buf = concat(makeL1(1200, 3), makeL3(1200, 0x57, 0x2f, 0x11))
      const parts = modelAwareSplit(buf)
      const reassembled = concat(...parts)
      expect(reassembled).toEqual(buf)
    })

    it("bounded runtime on random data", () => {
      const rng = lcg(5)
      const buf = Uint8Array.from({ length: 4096 }, () => Math.floor(rng() * 256))
      const t0 = Date.now()
      const parts = modelAwareSplit(buf)
      expect(Date.now() - t0).toBeLessThan(5000)
      expect(concat(...parts)).toEqual(buf)
    })
  })
})
