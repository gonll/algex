// Buffer ↔ GF(2^8) element array conversions and shared byte utilities

// GF(2^8) elements are just byte values — no conversion needed beyond typing
export const toSeq = (buf: Uint8Array): number[] => Array.from(buf)
export const fromSeq = (seq: number[]): Uint8Array => Uint8Array.from(seq)

// XOR two equal-length buffers. If b is empty, a is returned unchanged.
export const xorBytes = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  b.length === 0
    ? Uint8Array.from(a)
    : Uint8Array.from(a, (v, i) => v ^ b[i]!)

// Concatenate an array of Uint8Arrays into one flat buffer
export const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// True when every byte in buf is 0
export const isAllZero = (buf: Uint8Array): boolean =>
  buf.every((b) => b === 0)
