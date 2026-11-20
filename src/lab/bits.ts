// Laboratorio de búsqueda inversa — utilidades de bits y de costo.
// Aislado del encoder: nada de src/codec depende de este directorio.

export const bytesToBits = (b: Uint8Array, msbFirst: boolean): Uint8Array => {
  const out = new Uint8Array(b.length * 8)
  for (let i = 0; i < b.length; i++) {
    const v = b[i]!
    for (let k = 0; k < 8; k++) out[i * 8 + k] = msbFirst ? (v >> (7 - k)) & 1 : (v >> k) & 1
  }
  return out
}

export const bitsToBytes = (bits: Uint8Array, msbFirst: boolean): Uint8Array => {
  const out = new Uint8Array(Math.ceil(bits.length / 8))
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) out[i >> 3]! |= msbFirst ? 1 << (7 - (i & 7)) : 1 << (i & 7)
  }
  return out
}

/** Bits de un código Elias-gamma para x >= 0 (se codifica x+1). */
export const gammaBits = (x: number): number => 2 * Math.floor(Math.log2(x + 1)) + 1

export const bitLen = (x: bigint): number => (x === 0n ? 0 : x.toString(2).length)

export const bitsToBigInt = (bits: Uint8Array): bigint => {
  // bits[0] es el menos significativo (convención 2-ádica)
  let hex = ""
  const n = bits.length
  for (let i = 0; i < n; i += 4) {
    const v = (bits[i] ?? 0) | ((bits[i + 1] ?? 0) << 1) | ((bits[i + 2] ?? 0) << 2) | ((bits[i + 3] ?? 0) << 3)
    hex = v.toString(16) + hex
  }
  return hex === "" ? 0n : BigInt("0x" + hex)
}

export const bigIntToBits = (x: bigint, n: number): Uint8Array => {
  const out = new Uint8Array(n)
  const hex = x.toString(16)
  // hex[0] es el nibble más significativo
  for (let j = 0; j < hex.length; j++) {
    const v = parseInt(hex[hex.length - 1 - j]!, 16)
    for (let k = 0; k < 4; k++) {
      const idx = j * 4 + k
      if (idx < n) out[idx] = (v >> k) & 1
    }
  }
  return out
}

/**
 * PRNG determinista para corpus reproducibles: mulberry32 (no lineal).
 * NO usar xorshift: cada bit de salida de un xorshift es una LFSR sobre GF(2) (grado 32),
 * y el laboratorio la detecta — hallazgo real de la primera corrida (ver docs/research).
 */
export const prng = (seed: number) => {
  let s = seed >>> 0
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}
