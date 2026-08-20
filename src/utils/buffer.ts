// Buffer ↔ GF(2^8) element array conversions and shared byte utilities.
//
// These run on every chunk, often several times per chunk across the
// candidate search (roadmap 2, Priority 8: profiling showed this file's
// callback-based Array/Uint8Array methods as a measurable hot path — a plain
// for-loop avoids the per-element callback-invocation overhead V8 pays for
// .from(src, fn), .every(fn), and .reduce(fn) on typed arrays).

// GF(2^8) elements are just byte values — no conversion needed beyond typing.
export const toSeq = (buf: Uint8Array): number[] => {
  const n = buf.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = buf[i]!
  return out
}

export const fromSeq = (seq: number[]): Uint8Array => {
  const n = seq.length
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = seq[i]!
  return out
}

// XOR two equal-length buffers. If b is empty, a is returned unchanged.
export const xorBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const n = a.length
  const out = new Uint8Array(n)
  if (b.length === 0) { out.set(a); return out }
  for (let i = 0; i < n; i++) out[i] = a[i]! ^ b[i]!
  return out
}

// Concatenate an array of Uint8Arrays into one flat buffer
export const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// True when every byte in buf is 0
export const isAllZero = (buf: Uint8Array): boolean => {
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return false
  return true
}
