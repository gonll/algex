import { describe, it, expect } from "vitest"
import { compress, decompress } from "../index"
import { encodeChunk } from "./encoder"
import { serializeChunk } from "./format"

// Regresión: tryLFSR16 aceptaba L16 = 32 (el tope BM16_MAX_L) aunque el addon nativo devuelve en ese caso
// `length = 32` con `coeffs` vacío (c/addon.c: `nc = (L < BM16_MAX_L) ? L : 0`). El chunk resultante tenía
// seed de 64 bytes y 0 coeficientes: preparedSize reservaba 0 bytes de semilla y writeChunk escribía 64
// -> `RangeError: offset is out of bounds` en format.ts (hallado con una columna real de 196 590 bytes).
// Una secuencia de ceros con la primera palabra de 16 bits no nula en la posición k tiene complejidad lineal
// k + 1 (Berlekamp-Massey), así que k = 31 da L16 = 32 exactamente.
const sparseWords = (bytes: number, k: number): Uint8Array => { const d = new Uint8Array(bytes); d[2 * k] = 0x34; d[2 * k + 1] = 0x12; return d }
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

describe("LFSR16 con orden en el tope BM16_MAX_L = 32 (regresión del RangeError de writeChunk)", () => {
  it.each([[200, 31], [4092, 31]] as const)("%i bytes, palabra no nula en %i (L16 = 32): encodeChunk -> serializeChunk no lanza", (bytes, k) => {
    const c = encodeChunk(sparseWords(bytes, k))
    expect(() => serializeChunk(c)).not.toThrow()          // antes: RangeError offset is out of bounds
    if (c.kind === "lfsr16") expect(c.seed.length).toBe(c.coeffs.length * 2)
  })
  it.each([["fast"], ["balanced"], ["max"]] as const)("L16 = 32, modo %s: compress/decompress con round trip exacto", (mode) => {
    const d = sparseWords(4092, 31)
    expect(same(decompress(compress(d, mode)), d)).toBe(true)
  })
  it.each([30, 31, 32, 40])("alrededor del tope (palabra no nula en %i): round trip exacto", (k) => {
    const d = sparseWords(2000, k)
    expect(same(decompress(compress(d, "balanced")), d)).toBe(true)
  })
  it("L16 = 32 dentro de un archivo con varios chunks: round trip exacto", () => {
    const d = new Uint8Array(3 * 4096); d.set(sparseWords(4092, 31), 0)
    for (let i = 4096; i < 8192; i++) d[i] = (i * 7) & 255
    d.set(sparseWords(4092, 31), 8192)
    expect(same(decompress(compress(d, "balanced")), d)).toBe(true)
  })
})

// Corrección en el C nativo: `bm16Solve` devolvía coeffs vacío con L == BM16_MAX_L (comparación `<` en vez de `<=`).
// Con el arreglo, un LFSR16 real de orden 32 se recupera con sus coeficientes exactos y comprime de verdad.
import { addon } from "../native/addon"
describe("addon nativo: LFSR16 de orden exactamente 32", () => {
  const L = 32
  const coeffs = Array.from({ length: L }, (_, i) => ((i * 2654435761 + 7) & 0xffff) || 1)
  const seed = Buffer.alloc(L * 2); for (let i = 0; i < seed.length; i++) seed[i] = (i * 37 + 11) & 255
  const seq = Buffer.from(addon.lfsr16Run(coeffs, seed, 2048))   // 4096 bytes
  it("bm16Solve devuelve length = 32 con 32 coeficientes idénticos a los generadores", () => {
    const r = addon.bm16Solve(seq)
    expect(r.length).toBe(32)
    expect(r.coeffs).toEqual(coeffs)
  })
  it("compress/decompress: round trip exacto y comprime (ya no cae a crudo)", () => {
    const out = compress(new Uint8Array(seq), "balanced")
    expect(same(decompress(out), new Uint8Array(seq))).toBe(true)
    expect(out.length).toBeLessThan(seq.length / 10)
  })
  it("L = 33 sigue sin coeficientes (tope real) y no rompe nada", () => {
    expect(addon.bm16Solve(sparseWords(2000, 32) as unknown as Buffer).coeffs.length).toBe(0)
  })
})
