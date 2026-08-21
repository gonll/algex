// Does the codec's structural encoding add anything over plain gzip/brotli
// on realistic mixed content, now that wrapSmallest() already exists? Uses a
// fixed seed and stable (non-actively-edited) source files so repeated runs
// are comparable — this is used for A/B timing comparisons, not just ratio.

import { readFileSync } from "fs"
import { gzipSync, brotliCompressSync, constants } from "zlib"
import { compress } from "../src/index"
import { gfMul, gfAdd } from "../src/utils/gf256"

const makeL2 = (n: number, c1: number, c2: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = 1; buf[1] = 3
  for (let i = 2; i < n; i++) buf[i] = gfAdd(gfMul(c1, buf[i - 1]!), gfMul(c2, buf[i - 2]!))
  return buf
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

// mulberry32 — deterministic PRNG so the "random" region is identical across runs.
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const textSources = ["README.md", "package.json", "LICENSE", "c/analyze.c", "c/gf256.c"]
const textBytes = concat(...textSources.map(f => {
  const b = readFileSync(f)
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}))
const rng = mulberry32(42)
const randomBytes = Uint8Array.from({ length: 32 * 1024 }, () => Math.floor(rng() * 256))
const file = concat(makeL2(64 * 1024, 0x1b, 0x4e), textBytes, randomBytes)

console.log(`input: ${file.length} bytes (fixed seed, stable sources)`)

const N = 3
const times: number[] = []
let codecOut: Uint8Array = file
for (let i = 0; i < N; i++) {
  const t0 = Date.now()
  codecOut = compress(file)
  times.push(Date.now() - t0)
}
times.sort((a, b) => a - b)
console.log(`codec compress():  ${codecOut.length} bytes (${(codecOut.length / file.length * 100).toFixed(1)}%)  runs=[${times.join(", ")}]ms median=${times[Math.floor(N / 2)]}ms`)

const t1 = Date.now()
const gz = gzipSync(Buffer.from(file), { level: 9 })
console.log(`plain gzip -9:      ${gz.length} bytes (${(gz.length / file.length * 100).toFixed(1)}%)  [${Date.now() - t1}ms]`)

const t2 = Date.now()
const br = brotliCompressSync(Buffer.from(file), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
console.log(`plain brotli-9:     ${br.length} bytes (${(br.length / file.length * 100).toFixed(1)}%)  [${Date.now() - t2}ms]`)

// Also isolate: just the pure-algebraic 64KB segment, to confirm the codec
// still wins big where it's actually supposed to.
const algOnly = makeL2(64 * 1024, 0x1b, 0x4e)
const algCodec = compress(algOnly)
const algBr = brotliCompressSync(Buffer.from(algOnly), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
console.log(`\nalgebraic-only 64KB segment:`)
console.log(`codec:  ${algCodec.length} bytes (${(algCodec.length / algOnly.length * 100).toFixed(2)}%)`)
console.log(`brotli: ${algBr.length} bytes (${(algBr.length / algOnly.length * 100).toFixed(2)}%)`)
