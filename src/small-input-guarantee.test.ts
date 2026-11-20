import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "fs"
import { brotliCompressSync, constants } from "zlib"
import { compress, decompress } from "./index"

// Regresión: en entradas pequeñas el encoder halla "estructura" aproximada (p. ej. 88 % de fixup.dat, 7 KB) que pierde
// 40-50 % frente a brotli-11, y wrapFile solo competía contra el original con < 25 % estructurado. Ahora, por debajo de
// 1 MiB, el original siempre compite: la salida nunca supera brotli-11(original) + 1 byte de marcador.
const br11 = (d: Uint8Array) => brotliCompressSync(d, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: d.length } }).length
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0
const prng = (seed: number) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s } }

describe("entradas pequeñas: nunca peor que brotli-11 + 1 byte", () => {
  it.each(["firmware/fixup.dat", "pcap/STP_UplinkFast.pcapng"])("dato real %s (se omite si no está descargado)", (f) => {
    const p = `test/real-data/${f}`
    if (!existsSync(p)) return
    const b = readFileSync(p), d = new Uint8Array(b.buffer, b.byteOffset, b.length)
    for (const mode of ["balanced", "max"] as const) {
      const c = compress(d, mode)
      expect(same(decompress(c), d)).toBe(true)
      expect(c.length).toBeLessThanOrEqual(br11(d) + 1)
    }
  })
  it("contadores casi periódicos con ruido (sintético): round trip exacto y ≤ brotli-11 + 1", () => {
    const r = prng(42)
    for (const n of [900, 3000, 7000, 20000]) {
      const d = new Uint8Array(n).map((_, i) => (i * 5 + (r() % 11 === 0 ? r() & 3 : 0)) & 255)
      const c = compress(d, "balanced")
      expect(same(decompress(c), d)).toBe(true)
      expect(c.length).toBeLessThanOrEqual(br11(d) + 1)
    }
  })
})
