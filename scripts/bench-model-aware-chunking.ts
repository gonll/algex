// Roadmap 2, Priority 1: quantify the win from model-aware chunking over the
// old blind-midpoint bisection, on a case specifically designed to break
// midpoint bisection — a short model followed by a much longer one, so the
// true boundary is far from the geometric midpoint of the combined region.

import { gfMul, gfAdd } from "../src/utils/gf256"
import { encode } from "../src/codec/encoder"
import { serialize } from "../src/codec/format"

const makeL1 = (n: number, coeff: number, seed = 1): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = seed
  for (let i = 1; i < n; i++) buf[i] = gfMul(coeff, buf[i - 1]!)
  return buf
}

const makeL3 = (n: number, c1: number, c2: number, c3: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = 5; buf[1] = 11; buf[2] = 17
  for (let i = 3; i < n; i++)
    buf[i] = gfAdd(gfAdd(gfMul(c1, buf[i - 1]!), gfMul(c2, buf[i - 2]!)), gfMul(c3, buf[i - 3]!))
  return buf
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

// Short L=1 region followed by a much longer L=3 region — both read as
// ~8 bits/byte to Shannon entropy, so the entropy pass won't reliably split
// here, and the true boundary (at byte 200) is far from where a blind
// midpoint bisection of a ~3800-byte combined region would land.
const short = makeL1(200, 3)
const long = makeL3(3800, 0x57, 0x2f, 0x11)
const buf = concat(short, long)

const file = encode(buf)
const wire = serialize(file)

console.log(`input: ${buf.length} B, true boundary at byte ${short.length}`)
console.log(`chunks: ${file.chunks.length} (${file.chunks.map(c => c.kind === "raw" ? "raw" : c.kind).join(", ")})`)
console.log(`compressed: ${wire.length} B (${(wire.length / buf.length * 100).toFixed(2)}%)`)

let offset = 0
for (const c of file.chunks) {
  const len = c.kind === "raw" ? c.data.length : c.originalLength
  console.log(`  [${offset}, ${offset + len}) kind=${c.kind}`)
  offset += len
}
