import { describe, it, expect } from "vitest"
import { bytesToBits, bitsToBytes, prng, bitsToBigInt, bigIntToBits } from "./bits"
import { synthLfsr2, genLfsr2, costLfsr2 } from "./lfsr2"
import { synthFcsr, genFcsr, costFcsr } from "./fcsr"
import { synthDecRat, genDecRat, costDecRat } from "./decimal-rational"
import { genPrbsBits, genFcsrBits, genDecimalDigits } from "./corpus"

describe("bits", () => {
  it("roundtrip bytes<->bits en ambos órdenes", () => {
    const r = prng(1), b = Uint8Array.from({ length: 100 }, () => r() & 255)
    for (const msb of [true, false]) expect(bitsToBytes(bytesToBits(b, msb), msb)).toEqual(b)
  })
  it("roundtrip bigint<->bits", () => {
    const r = prng(2), bits = Uint8Array.from({ length: 777 }, () => r() & 1)
    expect(bigIntToBits(bitsToBigInt(bits), 777)).toEqual(bits)
  })
})

describe("LFSR sobre GF(2)", () => {
  it.each([7, 15, 23, 31])("recupera PRBS%i con L = orden exacto y reconstruye", (order) => {
    const bits = genPrbsBits(order, 20000)
    const m = synthLfsr2(bits, 4096)!
    expect(m.L).toBe(order)
    expect(genLfsr2(m)).toEqual(bits)
    expect(costLfsr2(m)).toBeLessThan(200)
  })
  it("control negativo: ruido aleatorio no se comprime (aborta)", () => {
    const r = prng(3), bits = Uint8Array.from({ length: 20000 }, () => r() & 1)
    expect(synthLfsr2(bits, 4096)).toBeNull()
  })
})

describe("FCSR / 2-ádico", () => {
  it("recupera p/q impar pequeño y reconstruye exacto", () => {
    const { bits, f, g } = genFcsrBits(40, 20000, 11)
    const m = synthFcsr(bits)!
    expect(genFcsr(m)).toEqual(bits)
    expect(costFcsr(m)).toBeLessThan(3 * (Math.max(f.toString(2).length, g.toString(2).length)) + 120)
  })
  it("control negativo: ruido no baja del costo crudo", () => {
    const r = prng(4), bits = Uint8Array.from({ length: 4096 }, () => r() & 1)
    const m = synthFcsr(bits)!
    expect(genFcsr(m)).toEqual(bits)          // siempre exacto…
    expect(costFcsr(m)).toBeGreaterThan(4096) // …pero nunca rentable
  })
})

describe("racional decimal", () => {
  it("recupera 1/9973 y reconstruye exacto", () => {
    const d = genDecimalDigits(1n, 9973n, 5000)
    const m = synthDecRat(d)!
    expect(m.q).toBe(9973n)
    expect(genDecRat(m)).toEqual(d)
    expect(costDecRat(m)).toBeLessThan(100)
  })
  it("no aplica a texto no numérico", () => {
    expect(synthDecRat(new TextEncoder().encode("hola mundo, esto no son digitos"))).toBeNull()
  })
})
