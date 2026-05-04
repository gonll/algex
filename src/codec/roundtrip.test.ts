import { describe, it, expect } from "vitest"
import { compress, decompress } from "../index"
import { gfMul } from "../utils/gf256"
import { splitInterleave, mergeInterleave } from "../utils/interleave"

const roundtrip = (buf: Uint8Array) => {
  const restored = decompress(compress(buf))
  expect(restored).toEqual(buf)
}

describe("compress → decompress roundtrip", () => {
  it("constant sequence", () => roundtrip(new Uint8Array(1024).fill(99)))

  it("GF(2^8) geometric sequence", () => {
    const buf = new Uint8Array(1024)
    buf[0] = 1
    for (let i = 1; i < 1024; i++) buf[i] = gfMul(3, buf[i - 1]!)
    roundtrip(buf)
  })

  it("GF(2^8) 2-tap recurrence", () => {
    const buf = new Uint8Array(1024)
    buf[0] = 7; buf[1] = 23
    for (let i = 2; i < 1024; i++) buf[i] = gfMul(2, buf[i - 1]!) ^ gfMul(3, buf[i - 2]!)
    roundtrip(buf)
  })

  it("random bytes", () => {
    const buf = Uint8Array.from({ length: 1024 }, () => Math.floor(Math.random() * 256))
    roundtrip(buf)
  })

  it("single byte", () => roundtrip(new Uint8Array([42])))

  it("empty buffer", () => roundtrip(new Uint8Array(0)))

  it("size not a multiple of chunk size", () => {
    roundtrip(new Uint8Array(777).fill(1))
  })
})

describe("compression ratios", () => {
  it("GF(2^8) geometric compresses below 5%", () => {
    const buf = new Uint8Array(4096)
    buf[0] = 1
    for (let i = 1; i < 4096; i++) buf[i] = gfMul(3, buf[i - 1]!)
    const ratio = compress(buf).length / buf.length
    expect(ratio).toBeLessThan(0.05)
  })

  it("constant compresses below 5%", () => {
    const buf = new Uint8Array(4096).fill(255)
    const ratio = compress(buf).length / buf.length
    expect(ratio).toBeLessThan(0.05)
  })

  it("random does not expand beyond 5% overhead", () => {
    const buf = Uint8Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))
    const ratio = compress(buf).length / buf.length
    expect(ratio).toBeLessThanOrEqual(1.05)
  })
})

describe("transform path roundtrips", () => {
  it("affine L=1 sequence (y[n] = c*y[n-1] ^ b) roundtrip", () => {
    // y[n] = 0x03 * y[n-1] ^ 0x1b — handled by the affine path
    const buf = new Uint8Array(2048)
    buf[0] = 0x07
    for (let i = 1; i < buf.length; i++) buf[i] = gfMul(0x03, buf[i - 1]!) ^ 0x1b
    roundtrip(buf)
  })

  it("counter sequence (0,1,2,...,255 repeated) roundtrip via delta ADD", () => {
    // Wrapping counter: each diff is 1 → constant after deltaAdd1 → L=1 LFSR (coeff=0 → raw)
    // The cyclic path handles this, but delta ADD should also work
    const buf = Uint8Array.from({ length: 2048 }, (_, i) => i & 0xff)
    roundtrip(buf)
  })

  it("XOR counter (0,1,3,0,1,3,...) roundtrip via delta XOR", () => {
    // A repeating-XOR pattern: after deltaXor1 the period structure is exposed
    const buf = Uint8Array.from({ length: 2048 }, (_, i) => (i % 4) * 0x11)
    roundtrip(buf)
  })

  it("2-channel interleaved L=1 LFSR roundtrip", () => {
    // Channel 0: geometric with coeff=0x03; Channel 1: geometric with coeff=0x1b
    // Interleaved: [ch0[0], ch1[0], ch0[1], ch1[1], ...]
    const n = 2048
    const ch0 = new Uint8Array(n / 2)
    const ch1 = new Uint8Array(n / 2)
    ch0[0] = 0x01; ch1[0] = 0x05
    for (let i = 1; i < n / 2; i++) {
      ch0[i] = gfMul(0x03, ch0[i - 1]!)
      ch1[i] = gfMul(0x1b, ch1[i - 1]!)
    }
    const interleaved = new Uint8Array(n)
    for (let i = 0; i < n / 2; i++) { interleaved[2 * i] = ch0[i]!; interleaved[2 * i + 1] = ch1[i]! }
    roundtrip(interleaved)
  })

  it("no transform path expands random data beyond 5% overhead", () => {
    let s = 0xbeefdead >>> 0
    const buf = Uint8Array.from({ length: 4096 }, () => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s & 0xff
    })
    const ratio = compress(buf).length / buf.length
    expect(ratio).toBeLessThanOrEqual(1.05)
  })
})

describe("interleave utility roundtrip", () => {
  it("split → merge is identity for m=2", () => {
    const buf = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff)
    expect(mergeInterleave(splitInterleave(buf, 2), 2)).toEqual(buf)
  })

  it("split → merge is identity for m=3", () => {
    const buf = Uint8Array.from({ length: 999 }, (_, i) => (i * 7) & 0xff)
    expect(mergeInterleave(splitInterleave(buf, 3), 3)).toEqual(buf)
  })

  it("split → merge is identity for m=4", () => {
    const buf = Uint8Array.from({ length: 1024 }, (_, i) => (i * 13) & 0xff)
    expect(mergeInterleave(splitInterleave(buf, 4), 4)).toEqual(buf)
  })
})
