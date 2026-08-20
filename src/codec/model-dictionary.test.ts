// Priority 5: file-level LFSR model dictionary — dedupes repeated GF(2^8) LFSR
// coefficient arrays across non-adjacent top-level chunks.

import { describe, it, expect } from "vitest"
import { gfMul, gfAdd } from "../utils/gf256"
import { serialize, deserialize, serializeChunk } from "./format"
import { decode } from "./decoder"
import { encode } from "./encoder"
import { compress, decompress } from "../index"

// A clean L=2 GF(2^8) recurrence, long enough to dominate a chunk's size with
// its own coefficients if stored inline every time.
const makeL2 = (n: number, c1: number, c2: number, s0: number, s1: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = s0; buf[1] = s1
  for (let i = 2; i < n; i++) buf[i] = gfAdd(gfMul(c1, buf[i - 1]!), gfMul(c2, buf[i - 2]!))
  return buf
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

describe("Priority 5: LFSR model dictionary", () => {
  it("emits PAD5 and a smaller file when the same model repeats with unrelated chunks between uses", () => {
    // Same L=2 model (c1=0x1b, c2=0x4e) reused 6 times, separated by a
    // constant-byte run — a sharp entropy contrast so the chunker reliably
    // splits at each boundary instead of folding everything into one mixed
    // chunk (which is what a same-entropy separator like a linear ramp does).
    const modelA = () => makeL2(1200, 0x1b, 0x4e, 3, 7)
    const sep = new Uint8Array(400).fill(0x42)
    const parts: Uint8Array[] = []
    for (let i = 0; i < 6; i++) { parts.push(modelA()); parts.push(sep) }
    const buf = concat(...parts)

    const file = encode(buf)
    const withDict = serialize(file)

    // Confirm PAD5 magic (0x50414435) was actually chosen.
    const view = new DataView(withDict.buffer, withDict.byteOffset)
    expect(view.getUint32(0)).toBe(0x50414435)

    expect(decode(deserialize(withDict))).toEqual(buf)
  })

  it("stays PAD4 (no dictionary) when a model only appears once", () => {
    const buf = makeL2(2048, 0x57, 0x2f, 1, 2)
    const file = encode(buf)
    const wire = serialize(file)
    const view = new DataView(wire.buffer, wire.byteOffset)
    expect(view.getUint32(0)).toBe(0x50414434)  // PAD4, unchanged
    expect(decode(deserialize(wire))).toEqual(buf)
  })

  it("round-trips through the full compress/decompress pipeline with a repeated model", () => {
    const modelA = () => makeL2(1200, 0x1b, 0x4e, 5, 9)
    const sep = new Uint8Array(400).fill(0x77)
    const parts: Uint8Array[] = []
    for (let i = 0; i < 6; i++) { parts.push(modelA()); parts.push(sep) }
    const buf = concat(...parts)

    const compressed = compress(buf)
    expect(decompress(compressed)).toEqual(buf)
  })

  it("reduces total size versus repeating the coefficients inline every time", () => {
    const modelA = () => makeL2(1200, 0x11, 0x22, 4, 6)
    const sep = new Uint8Array(400).fill(0x99)
    const parts: Uint8Array[] = []
    for (let i = 0; i < 6; i++) { parts.push(modelA()); parts.push(sep) }
    const buf = concat(...parts)

    const file = encode(buf)
    const lfsrGroups = new Map<string, number>()
    for (const c of file.chunks) {
      if (c.kind !== "lfsr") continue
      const key = c.lfsr.coeffs.join(",")
      lfsrGroups.set(key, (lfsrGroups.get(key) ?? 0) + 1)
    }
    // Sanity: the same model really did get reused non-adjacently multiple times.
    expect(Math.max(...lfsrGroups.values())).toBeGreaterThanOrEqual(4)

    const withDict = serialize(file)
    expect(new DataView(withDict.buffer, withDict.byteOffset).getUint32(0)).toBe(0x50414435)

    // Independent "no sharing" baseline: serializeChunk() never knows about a
    // file-level dictionary, so it always emits inline coefficients. Rebuild the
    // same file-level framing serialize() uses (12-byte header + per-chunk CRC +
    // EOF + XDNI index) around that inline total for an apples-to-apples size
    // comparison against the actual dictionary-using output.
    const n = file.chunks.length
    const inlineChunkTotal = file.chunks.reduce((s, c) => s + serializeChunk(c).length + 4, 0)
    const withoutDictTotal = 12 + inlineChunkTotal + 1 + (4 + 4 + n * 8 + 4)

    expect(withDict.length).toBeLessThan(withoutDictTotal)
  })

  it("still decodes a hand-built PAD5 buffer with a two-model dictionary and two references", () => {
    // Build a minimal PAD5 file by hand: header, a 2-model table, two
    // KIND_LFSR_REF chunks (one per model), EOF, XDNI index.
    const KIND_LFSR_REF = 9
    const EOF = 0xfe
    const XDNI = 0x58444e49

    const model0 = [3]        // L=1
    const model1 = [0x1b, 0x4e]  // L=2

    // Chunk A: references model 0, prefix empty, init [9], residual empty (kind=0 plain).
    const chunkABytes: number[] = []
    chunkABytes.push(KIND_LFSR_REF)
    const origLenA = 4
    chunkABytes.push(0, 0, 0, origLenA)  // origLen BE
    chunkABytes.push(0)                 // prefixLen=0
    chunkABytes.push(0, 0)              // modelId=0 (BE uint16)
    chunkABytes.push(9)                 // init[0]
    chunkABytes.push(0)                 // residual kind=0 (empty) as the "plain" wire (flag=0 plain, then packed residual byte 0x00)
    chunkABytes.push(0)                 // packResidual empty => [0]

    // Chunk B: references model 1, prefix empty, init [1,2], residual empty.
    const chunkBBytes: number[] = []
    chunkBBytes.push(KIND_LFSR_REF)
    const origLenB = 5
    chunkBBytes.push(0, 0, 0, origLenB)
    chunkBBytes.push(0)
    chunkBBytes.push(0, 1)              // modelId=1
    chunkBBytes.push(1, 2)              // init[0], init[1]
    chunkBBytes.push(0)                 // residual flag=plain
    chunkBBytes.push(0)                 // packed empty residual

    const crc32 = (data: number[]): number => {
      const table = (() => {
        const t = new Uint32Array(256)
        for (let i = 0; i < 256; i++) {
          let c = i
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
          t[i] = c >>> 0
        }
        return t
      })()
      let crc = 0xFFFFFFFF
      for (const b of data) crc = table[(crc ^ b) & 0xFF]! ^ (crc >>> 8)
      return (crc ^ 0xFFFFFFFF) >>> 0
    }

    const crcA = crc32(chunkABytes)
    const crcB = crc32(chunkBBytes)
    const toBE32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

    const bytes: number[] = []
    bytes.push(...toBE32(0x50414435))       // magic PAD5
    bytes.push(...toBE32(origLenA + origLenB)) // originalSize (arbitrary here, unused by readChunkAt/decode path we test)
    bytes.push(...toBE32(2))                // chunkCount=2
    // model table: modelCount=2
    bytes.push(0, 2)
    bytes.push(0, 1, ...model0)             // L=1, coeffs=[3]
    bytes.push(0, 2, ...model1)             // L=2, coeffs=[0x1b,0x4e]

    const chunkAOffset = bytes.length
    bytes.push(...chunkABytes, ...toBE32(crcA))
    const chunkBOffset = bytes.length
    bytes.push(...chunkBBytes, ...toBE32(crcB))
    bytes.push(EOF)

    const indexOffset = bytes.length
    bytes.push(...toBE32(XDNI))
    bytes.push(...toBE32(2))
    bytes.push(...toBE32(chunkAOffset), ...toBE32(origLenA))
    bytes.push(...toBE32(chunkBOffset), ...toBE32(origLenB))
    bytes.push(...toBE32(indexOffset))

    const buf = Uint8Array.from(bytes)
    const file = deserialize(buf)
    expect(file.chunks.length).toBe(2)
    expect(file.chunks[0]).toMatchObject({ kind: "lfsr", lfsr: { coeffs: [3], length: 1 }, init: [9] })
    expect(file.chunks[1]).toMatchObject({ kind: "lfsr", lfsr: { coeffs: [0x1b, 0x4e], length: 2 }, init: [1, 2] })
  })
})
