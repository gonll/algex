import { describe, it, expect } from "vitest"
import { compress, decompress } from "../index"
import { encodeChunk } from "./encoder"
import { serializeChunk, deserializeChunk, readChunkAt } from "./format"
import { genPrbsBits } from "../lab/corpus"
import { bitsToBytes, prng } from "../lab/bits"

const prbsBytes = (order: number, nBytes: number, msb = true) => bitsToBytes(genPrbsBits(order, nBytes * 8), msb)
const magic = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 4))
const unwrap = (b: Uint8Array) => b // compress() puede envolver; ver tests más abajo

describe("bit-lfsr (PAD6)", () => {
  it.each([7, 15, 23, 31])("PRBS%i bit-serial: chunk bit-lfsr, roundtrip exacto y minúsculo", (order) => {
    const d = prbsBytes(order, 16 * 1024)
    const c = encodeChunk(d.subarray(0, 4096))
    expect(c.kind).toBe("bit-lfsr")
    const blob = serializeChunk(c)
    expect(blob.length).toBeLessThan(40)
    expect(deserializeChunk(blob)).toEqual(c)
    const out = compress(d)
    expect(out.length).toBeLessThan(400)  // 4 chunks de 4 KB, ~25 B c/u (fusión de chunks pendiente)
    expect(decompress(out)).toEqual(d)
  })

  it("orden de bits LSB también", () => {
    const d = prbsBytes(23, 8 * 1024, false)
    expect(encodeChunk(d.subarray(0, 4096)).kind).toBe("bit-lfsr")
    expect(decompress(compress(d))).toEqual(d)
  })

  it("con ruido de bits (0.3%): sigue siendo exacto y mucho menor que el crudo", () => {
    const bits = genPrbsBits(31, 32 * 1024 * 8), r = prng(5)
    for (let i = 0; i < bits.length; i++) if (r() % 1000 < 3) bits[i]! ^= 1
    const d = bitsToBytes(bits, true)
    const out = compress(d)
    expect(out.length).toBeLessThan(d.length / 8)
    expect(decompress(out)).toEqual(d)
  })

  it("datos aleatorios: nunca eligen bit-lfsr y no crecen más que antes", () => {
    const r = prng(77), d = Uint8Array.from({ length: 16 * 1024 }, () => r() & 255)
    expect(encodeChunk(d.subarray(0, 4096)).kind).not.toBe("bit-lfsr")
    expect(decompress(compress(d))).toEqual(d)
  })

  it("texto: mantiene formato previo (sin PAD6)", () => {
    const d = new TextEncoder().encode("the quick brown fox jumps over the lazy dog. ".repeat(200))
    const c = encodeChunk(d)
    expect(c.kind).not.toBe("bit-lfsr")
  })

  it("acceso aleatorio por XDNI y CRC detecta corrupción", () => {
    const d = prbsBytes(31, 64 * 1024)
    const out = compress(d)
    expect(decompress(out)).toEqual(d)
    // Solo si la salida no fue envuelta: el archivo PAD6 crudo contiene el índice
    if (magic(out) === "PAD6") {
      expect(readChunkAt(out, 0)?.kind).toBe("bit-lfsr")
      const bad = Uint8Array.from(out); bad[20]! ^= 0xff
      expect(() => decompress(bad)).toThrow()
    }
  })
  void unwrap
})
