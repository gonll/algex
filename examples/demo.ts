// Roundtrip demo + compression stats.
// Tests: pure LFSR, noisy LFSR (sparse residual), Padé prefix, adaptive chunking.

import { compress, decompress, encode } from "../src/index"
import { shannonEntropy } from "../src/core/entropy"
import { gfMul } from "../src/utils/gf256"
import { packResidual } from "../src/utils/sparse"

// --- generators ---

const makeGFGeometric = (n: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = 1
  for (let i = 1; i < n; i++) buf[i] = gfMul(3, buf[i - 1]!)
  return buf
}

// GF geometric + 5% random noise — tests sparse residual path
const makeNoisyGF = (n: number, noisePct = 0.05): Uint8Array => {
  const buf = makeGFGeometric(n)
  const flips = Math.floor(n * noisePct)
  for (let i = 0; i < flips; i++) {
    const pos = Math.floor(Math.random() * n)
    buf[pos] ^= Math.floor(Math.random() * 255) + 1  // guaranteed non-zero flip
  }
  return buf
}

// Noise prefix + GF geometric suffix — tests Padé offset-BM path
const makePrefixNoise = (n: number, prefixLen = 16): Uint8Array => {
  const prefix = Uint8Array.from({ length: prefixLen }, () => Math.floor(Math.random() * 256))
  const body   = makeGFGeometric(n - prefixLen)
  const buf    = new Uint8Array(n)
  buf.set(prefix); buf.set(body, prefixLen)
  return buf
}

// Alternating blocks: structured | random | structured — tests adaptive chunking
const makeMixed = (n: number): Uint8Array => {
  const third = Math.floor(n / 3)
  const buf = new Uint8Array(n)
  buf.set(makeGFGeometric(third), 0)
  for (let i = third; i < third * 2; i++) buf[i] = Math.floor(Math.random() * 256)
  buf.set(makeGFGeometric(n - third * 2), third * 2)
  return buf
}

// --- reporting ---

const pct = (a: number, b: number): string => ((a / b) * 100).toFixed(1) + "%"

const report = (label: string, original: Uint8Array): void => {
  const compressed = compress(original)
  const recovered  = decompress(compressed)
  const ok = original.length === recovered.length && original.every((b, i) => b === recovered[i])

  const file = encode(original)
  const lfsrChunks = file.chunks.filter((c) => c.kind === "lfsr")
  const rawChunks  = file.chunks.filter((c) => c.kind === "raw")

  const avgL = lfsrChunks.length === 0 ? 0
    : lfsrChunks.reduce((s, c) => s + (c.kind === "lfsr" ? c.lfsr.length : 0), 0) / lfsrChunks.length

  const avgOffset = lfsrChunks.length === 0 ? 0
    : lfsrChunks.reduce((s, c) => s + (c.kind === "lfsr" ? c.prefix.length : 0), 0) / lfsrChunks.length

  const sparseChunks = lfsrChunks.filter((c) => {
    if (c.kind !== "lfsr") return false
    const packed = packResidual(c.residual)
    return packed[0] === 2  // kind=sparse
  }).length

  console.log(`\n── ${label} ──`)
  console.log(`  size:     ${original.length} B → ${compressed.length} B  (${pct(compressed.length, original.length)})`)
  console.log(`  entropy:  ${shannonEntropy(original).toFixed(2)} bits/byte`)
  console.log(`  chunks:   ${lfsrChunks.length} LFSR (avgL=${avgL.toFixed(0)} offset=${avgOffset.toFixed(1)} sparse=${sparseChunks})  ${rawChunks.length} raw`)
  console.log(`  lossless: ${ok ? "✓" : "✗  MISMATCH — BUG"}`)
}

// --- run ---

const N = 4096

report("GF(2⁸) geometric  [L=1, perfect]",         makeGFGeometric(N))
report("Noisy GF  [L=1, sparse residual]",           makeNoisyGF(N))
report("Noise prefix + GF body  [Padé offset]",      makePrefixNoise(N))
report("Structured|Random|Structured  [adaptive]",   makeMixed(N))
