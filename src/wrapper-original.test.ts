// Wrapper de ORIGINAL (marcadores 0xb3 / 0xb4): sin estructura, nunca peor que brotli-11 / zstd del original + 1 B.
import { describe, it, expect } from "vitest"
import * as zlib from "zlib"
import { compress, decompress, encode, wrapFile, serialize, wrapSmallest } from "./index"
import { genPrbsBits } from "./lab/corpus"
import { bitsToBytes, prng } from "./lab/bits"

const br = (d: Uint8Array) => zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: d.length } }).length
const jsonish = () => new TextEncoder().encode(JSON.stringify(Array.from({ length: 900 }, (_, i) => ({ id: i * 37 % 1013, name: "item-" + (i * 7919 % 10007), tags: ["a", "bb", "ccc"].slice(0, i % 4) }))))
const rnd = (n: number, seed: number) => { const r = prng(seed); return Uint8Array.from({ length: n }, () => r() & 255) }

describe("wrapper de original", () => {
  it("JSON/texto sin estructura: marcador 0xb3, roundtrip exacto y <= brotli(original)+1", () => {
    const d = jsonish()
    const out = compress(d)
    expect(out[0]).toBe(0xb3)
    expect(out.length).toBeLessThanOrEqual(br(d) + 1)
    expect(decompress(out)).toEqual(d)
  })
  it("aleatorio: no expande más que brotli+1 y hace roundtrip", () => {
    const d = rnd(20000, 3)
    const out = compress(d)
    expect(out.length).toBeLessThanOrEqual(br(d) + 1)
    expect(decompress(out)).toEqual(d)
  })
  it("modo fast: marcador 0xb4 (zstd/gzip del original) y roundtrip exacto", () => {
    const d = jsonish()
    const out = compress(d, "fast")
    expect(out[0]).toBe(0xb4)
    expect(decompress(out)).toEqual(d)
  })
  it("datos estructurados (PRBS) siguen por el camino PAD y no cambian de tamaño relevante", () => {
    const d = bitsToBytes(genPrbsBits(31, 64 * 1024 * 8), true)
    const out = compress(d)
    expect(out[0]).not.toBe(0xb3)
    expect(out.length).toBeLessThan(200)
    expect(decompress(out)).toEqual(d)
  })
  it("mixto con poca estructura: nunca más grande que el wrapper anterior", () => {
    const d = new Uint8Array([...jsonish(), ...bitsToBytes(genPrbsBits(23, 4096 * 8), true), ...jsonish()])
    const file = encode(d)
    const prev = wrapSmallest(serialize(file))
    const now = wrapFile(d, file)
    expect(now.length).toBeLessThanOrEqual(prev.length)
    expect(decompress(now)).toEqual(d)
  })
  it("casos límite: vacío y 1 byte", () => {
    for (const d of [new Uint8Array(0), Uint8Array.of(7), Uint8Array.of(0, 0, 0)])
      expect(decompress(compress(d))).toEqual(d)
  })
  it("compatibilidad: los archivos de salida previos (PAD cruda / brotli(PAD) / zstd(PAD)) siguen decodificando", () => {
    const d = bitsToBytes(genPrbsBits(15, 8192 * 8), true)
    const pade = serialize(encode(d))
    expect(decompress(pade)).toEqual(d)                     // PAD cruda
    expect(decompress(wrapSmallest(pade))).toEqual(d)       // wrapper previo
  })
})
