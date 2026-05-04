// Generates a binary file with GF(2^8) linear recurrence structure.
// Mixes several LFSR sequences back-to-back to simulate a realistic "structured binary".

import { writeFileSync } from "fs"
import { gfMul, gfAdd } from "../src/utils/gf256"

// L=1: s[i] = coeff * s[i-1]
const makeL1 = (n: number, coeff: number, seed = 1): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = seed
  for (let i = 1; i < n; i++) buf[i] = gfMul(coeff, buf[i - 1]!)
  return buf
}

// L=2: s[i] = c1*s[i-1] + c2*s[i-2]
const makeL2 = (n: number, c1: number, c2: number, s0 = 1, s1 = 3): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = s0; buf[1] = s1
  for (let i = 2; i < n; i++) buf[i] = gfAdd(gfMul(c1, buf[i - 1]!), gfMul(c2, buf[i - 2]!))
  return buf
}

// L=3: s[i] = c1*s[i-1] + c2*s[i-2] + c3*s[i-3]
const makeL3 = (n: number, c1: number, c2: number, c3: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = 0x01; buf[1] = 0x07; buf[2] = 0x1f
  for (let i = 3; i < n; i++)
    buf[i] = gfAdd(gfAdd(gfMul(c1, buf[i - 1]!), gfMul(c2, buf[i - 2]!)), gfMul(c3, buf[i - 3]!))
  return buf
}

// Add light noise (like a real-world device that has bit errors)
const addNoise = (buf: Uint8Array, errorRate = 0.02): Uint8Array => {
  const out = new Uint8Array(buf)
  const flips = Math.floor(buf.length * errorRate)
  for (let i = 0; i < flips; i++) {
    const pos = Math.floor(Math.random() * buf.length)
    out[pos]! ^= (Math.floor(Math.random() * 255) + 1)
  }
  return out
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

// Build a ~1MB file:
//   - 256KB  L=1 geometric (coeff=3, period=255)     ← trivial for BM
//   - 256KB  L=2 recurrence                           ← longer period, still algebraic
//   - 256KB  L=3 recurrence with 2% noise             ← tests sparse residual path
//   - 128KB  L=1 with a 16-byte random header         ← tests Padé offset path
//   - 128KB  L=1 with a different coeff               ← tests adaptive chunking boundary

const K = 1024
const header = Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))

const file = concat(
  makeL1(256 * K, 3),
  makeL2(256 * K, 0x1b, 0x4e),
  addNoise(makeL3(256 * K, 0x57, 0x2f, 0x11), 0.02),
  concat(header, makeL1(128 * K - 16, 7)),
  makeL1(128 * K, 0xe3),
)

writeFileSync("test/gf-structured.bin", file)
console.log(`Written test/gf-structured.bin  (${(file.length / 1024).toFixed(0)} KB)`)
