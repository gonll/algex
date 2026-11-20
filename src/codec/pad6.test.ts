// Compatibilidad y robustez de PAD6 (kind 11 bit-lfsr): magic condicional, convivencia con el
// diccionario de modelos PAD5, acceso aleatorio, streaming y detección de corrupción.
import { describe, it, expect } from "vitest"
import { gfMul, gfAdd } from "../utils/gf256"
import { serialize, deserialize, readChunkAt, streamDeserialize } from "./format"
import { decode } from "./decoder"
import { encode } from "./encoder"
import { BUDGETS } from "./search-budget"
import { genPrbsBits } from "../lab/corpus"
import { bitsToBytes, prng } from "../lab/bits"

const MAGIC_V4 = 0x50414434, MAGIC_V5 = 0x50414435, MAGIC_V6 = 0x50414436
const magic = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset).getUint32(0)
const prbs = (order: number, nBytes: number) => bitsToBytes(genPrbsBits(order, nBytes * 8), true)
const rnd = (n: number, seed: number) => { const r = prng(seed); return Uint8Array.from({ length: n }, () => r() & 255) }
const concat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length } return o }
const makeL2 = (n: number, c1: number, c2: number, s0: number, s1: number) => {
  const b = new Uint8Array(n); b[0] = s0; b[1] = s1
  for (let i = 2; i < n; i++) b[i] = gfAdd(gfMul(c1, b[i - 1]!), gfMul(c2, b[i - 2]!))
  return b
}

describe("PAD6", () => {
  it("archivo mixto (PRBS | aleatorio | PRBS): PAD6, roundtrip exacto, modelos y raw conviven", () => {
    const buf = concat(prbs(31, 8192), rnd(4096, 1), prbs(23, 8192))
    const wire = serialize(encode(buf))
    expect(magic(wire)).toBe(MAGIC_V6)
    expect(decode(deserialize(wire))).toEqual(buf)
    const kinds = deserialize(wire).chunks.map(c => c.kind)
    expect(kinds).toContain("bit-lfsr")
    expect(kinds).toContain("raw")
  })

  it("sin chunks bit-lfsr la salida NO cambia de formato (PAD4) y es idéntica con el candidato apagado", () => {
    const buf = concat(rnd(8192, 2), new TextEncoder().encode("hello world ".repeat(600)))
    const on = serialize(encode(buf))
    const off = serialize(encode(buf, { ...BUDGETS.balanced, enableBitLfsr: false }))
    expect(magic(on)).toBe(MAGIC_V4)
    expect(Buffer.compare(Buffer.from(on), Buffer.from(off))).toBe(0)
  })

  it("convive con el diccionario de modelos de PAD5 (mismo archivo, modelo repetido + bit-lfsr)", () => {
    const modelA = () => makeL2(1200, 0x1b, 0x4e, 3, 7)
    const sep = new Uint8Array(400).fill(0x42)
    const parts: Uint8Array[] = []
    for (let i = 0; i < 6; i++) { parts.push(modelA()); parts.push(sep) }
    parts.push(prbs(31, 8192))
    const buf = concat(...parts)
    const wire = serialize(encode(buf))
    expect(magic(wire)).toBe(MAGIC_V6)
    expect(decode(deserialize(wire))).toEqual(buf)
    // y sin el bit-lfsr el mismo archivo sigue siendo PAD5 (el diccionario no se pierde)
    const off = serialize(encode(buf, { ...BUDGETS.balanced, enableBitLfsr: false }))
    expect(magic(off)).toBe(MAGIC_V5)
  })

  it("readChunkAt (índice XDNI) y streamDeserialize leen chunks bit-lfsr", () => {
    const buf = concat(prbs(15, 8192), rnd(4096, 3))
    const wire = serialize(encode(buf))
    expect(magic(wire)).toBe(MAGIC_V6)
    const file = deserialize(wire)
    expect(readChunkAt(wire, 0)).toEqual(file.chunks[0])
    expect(readChunkAt(wire, file.chunks.length - 1)).toEqual(file.chunks[file.chunks.length - 1])
    expect([...streamDeserialize(wire)]).toEqual(file.chunks)
  })

  it("un byte corrupto dentro de un chunk bit-lfsr lo detecta el CRC", () => {
    const wire = serialize(encode(prbs(31, 8192)))
    expect(magic(wire)).toBe(MAGIC_V6)
    for (const off of [12 + 2 + 3, 12 + 2 + 9, 12 + 2 + 14]) {
      const bad = Uint8Array.from(wire); bad[off]! ^= 0x5a
      expect(() => decode(deserialize(bad))).toThrow()
    }
  })

  it("con ruido, el chunk bit-lfsr con residual hace roundtrip exacto por serialize/deserialize", () => {
    const bits = genPrbsBits(31, 4096 * 8), r = prng(9)
    for (let i = 0; i < bits.length; i++) if (r() % 1000 < 5) bits[i]! ^= 1
    const buf = bitsToBytes(bits, true)
    const file = encode(buf)
    expect(file.chunks.some(c => c.kind === "bit-lfsr" && c.errors.length > 0)).toBe(true)
    expect(decode(deserialize(serialize(file)))).toEqual(buf)
  })
})
