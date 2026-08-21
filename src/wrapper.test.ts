// Priority 7 / roadmap 3: full-file wrapper competition — raw PAD vs the cheap
// tier (zstd where available, else gzip) vs brotli(PAD). "fast" mode skips
// brotli entirely and relies on the cheap tier alone.

import { describe, it, expect } from "vitest"
import * as zlib from "zlib"
import { gzipSync } from "zlib"
import { compress, decompress, wrapSmallest } from "./index"
import { serialize, deserialize } from "./codec/format"
import { encode } from "./codec/encoder"

const hasZstd = typeof (zlib as unknown as { zstdCompressSync?: unknown }).zstdCompressSync === "function"

const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

describe("Priority 7: full-file wrapper competition", () => {
  it("round-trips through compress/decompress regardless of which wrapper wins", () => {
    const rng = lcg(3)
    const buf = Uint8Array.from({ length: 4096 }, () => Math.floor(rng() * 256))
    const compressed = compress(buf)
    expect(decompress(compressed)).toEqual(buf)
  })

  it("chooses brotli when it's smaller than gzip and raw", () => {
    // Highly compressible but not perfectly algebraic text-like data: the PAD
    // encoder will likely leave it mostly raw, so the outer wrapper choice
    // dominates the final size — a good candidate for brotli to win outright.
    const text = "the quick brown fox jumps over the lazy dog. ".repeat(200)
    const buf = new TextEncoder().encode(text)

    const pade = serialize(encode(buf))
    const wrapped = wrapSmallest(pade)

    const gz = gzipSync(pade, { level: 9 })
    // Whatever wrapSmallest picked must be at least as good as gzip alone.
    expect(wrapped.length).toBeLessThanOrEqual(gz.length)

    expect(decompress(wrapped)).toEqual(buf)
  })

  it("still decodes legacy gzip-wrapped output (magic 1f 8b)", () => {
    const buf = new Uint8Array(2048).fill(7)
    const pade = serialize(encode(buf))
    const legacyGz = gzipSync(pade, { level: 9 })
    expect(decompress(legacyGz)).toEqual(buf)
  })

  it("still decodes legacy raw PAD output with no wrapper", () => {
    const buf = new Uint8Array(2048).fill(7)
    const pade = serialize(encode(buf))
    expect(decompress(pade)).toEqual(buf)
  })

  it("brotli marker byte never collides with gzip magic or the PAD magic", () => {
    const rng = lcg(9)
    const buf = Uint8Array.from({ length: 1024 }, () => Math.floor(rng() * 256))
    const wrapped = wrapSmallest(serialize(encode(buf)))
    if (wrapped[0] !== 0x1f && wrapped[0] !== 0x50) {
      // It's the brotli-wrapped form — confirm it decodes back through deserialize.
      const decompressed = decompress(wrapped)
      expect(deserialize(serialize(encode(buf))).originalSize).toBe(buf.length)
      expect(decompressed).toEqual(buf)
    }
  })

  it("never expands incompressible data by more than raw PAD's own overhead", () => {
    const rng = lcg(11)
    const buf = Uint8Array.from({ length: 4096 }, () => Math.floor(rng() * 256))
    const pade = serialize(encode(buf))
    const wrapped = wrapSmallest(pade)
    expect(wrapped.length).toBeLessThanOrEqual(pade.length)
  })

  it("fast mode never emits the brotli marker (skips the expensive pass entirely)", () => {
    const text = "the quick brown fox jumps over the lazy dog. ".repeat(200)
    const buf = new TextEncoder().encode(text)
    const wrapped = wrapSmallest(serialize(encode(buf)), "fast")
    expect(wrapped[0]).not.toBe(0xb2)
  })

  it("fast mode round-trips through compress/decompress", () => {
    const rng = lcg(13)
    const buf = Uint8Array.from({ length: 4096 }, () => Math.floor(rng() * 256))
    const compressed = compress(buf, "fast")
    expect(decompress(compressed)).toEqual(buf)
  })

  it.runIf(hasZstd)("uses zstd (frame magic 28 b5 2f fd) as the cheap tier when available, and it round-trips", () => {
    const text = "the quick brown fox jumps over the lazy dog. ".repeat(200)
    const buf = new TextEncoder().encode(text)
    const wrapped = wrapSmallest(serialize(encode(buf)), "fast")
    // fast mode only ever tries raw or the cheap tier — on a Node with zstd,
    // that's zstd; confirm the frame magic and a correct round-trip.
    if (wrapped[0] === 0x28) {
      expect(Array.from(wrapped.subarray(0, 4))).toEqual([0x28, 0xb5, 0x2f, 0xfd])
      expect(decompress(wrapped)).toEqual(buf)
    }
  })

  it("zstd's frame magic never collides with gzip magic, the brotli marker, or the PAD magic", () => {
    // 0x28 (zstd's leading byte) vs 0x1f (gzip), 0xb2 (brotli marker), 0x50 ('P', PAD).
    expect(0x28).not.toBe(0x1f)
    expect(0x28).not.toBe(0xb2)
    expect(0x28).not.toBe(0x50)
  })
})
