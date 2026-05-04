import { describe, it, expect } from "vitest"
import { fixedChunks, adaptiveChunks } from "./chunker"

describe("fixedChunks", () => {
  it("splits evenly", () => {
    const chunks = fixedChunks(new Uint8Array(1024), 256)
    expect(chunks.length).toBe(4)
    expect(chunks.every((c) => c.length === 256)).toBe(true)
  })

  it("handles remainder chunk", () => {
    const chunks = fixedChunks(new Uint8Array(300), 128)
    expect(chunks.length).toBe(3)
    expect(chunks[2]!.length).toBe(44)
  })

  it("single chunk when buf ≤ chunk size", () => {
    const chunks = fixedChunks(new Uint8Array(64), 128)
    expect(chunks.length).toBe(1)
  })
})

describe("adaptiveChunks", () => {
  it("reassembled output equals original", () => {
    const buf = new Uint8Array(4096)
    buf.set(new Uint8Array(2048).fill(42))
    for (let i = 2048; i < 4096; i++) buf[i] = Math.floor(Math.random() * 256)
    const chunks = adaptiveChunks(buf)
    const reassembled = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let off = 0
    for (const c of chunks) { reassembled.set(c, off); off += c.length }
    expect(reassembled).toEqual(buf)
  })

  it("returns [buf] for very small input", () => {
    const buf = new Uint8Array(50).fill(7)
    expect(adaptiveChunks(buf)).toHaveLength(1)
  })

  it("detects boundary between low-entropy and high-entropy regions", () => {
    // First half: repeating constant (entropy ≈ 0)
    // Second half: pseudo-random (entropy ≈ 8 bits/byte)
    const buf = new Uint8Array(4096)
    buf.fill(0x42, 0, 2048)
    let x = 0xdeadbeef
    for (let i = 2048; i < 4096; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5
      buf[i] = x & 0xff
    }
    const chunks = adaptiveChunks(buf)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })
})
