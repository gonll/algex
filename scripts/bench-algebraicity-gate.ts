// Calibrates a cheap pre-gate for the expensive approx-LFSR search ladder
// (searchLFSRCandidates' L=1..5 brute-force/voting search, the actual hotspot
// found in the earlier codec-vs-plain-brotli benchmark).
//
// First attempt: reuse algebraicityScore (core/transform.ts) as-is. Rejected
// below — it's calibrated for a different, lower-risk gate (whether to try
// delta/interleave/bitplane transforms) and its short 8-byte half-windows
// overfit noise the same way structured data does, so it doesn't separate
// random/text from the fixture's genuinely noisy L=3 segment.
//
// Second attempt: "does ANY of several 20-byte windows across the chunk
// admit a low-order (<=5) EXACT BM fit". Noise tolerance comes from sampling
// multiple windows and requiring only one hit (not all), since a window is
// noise-free with reasonable probability even at a few percent per-byte
// error rate, while true random/text essentially never produces a low-order
// exact fit anywhere by chance.

import { readFileSync } from "fs"
import { algebraicityScore } from "../src/core/transform"
import { addon } from "../src/native/addon"

const fixture = readFileSync("test/gf-structured.bin")
const textSources = ["README.md", "src/codec/encoder.ts", "src/codec/chunker.ts", "package.json", "src/codec/format.ts"]

const sample = (buf: Uint8Array, n: number, seed: number): Uint8Array[] => {
  const out: Uint8Array[] = []
  for (let i = 0; i < n; i++) {
    const off = Math.floor((seed * 2654435761 + i * 40503) % Math.max(1, buf.length - 4096))
    out.push(buf.subarray(Math.abs(off), Math.abs(off) + 4096))
  }
  return out
}

const WINDOW = 20
const CAP = 5
const anyWindowFits = (chunk: Uint8Array, fractions = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]): boolean => {
  for (const f of fractions) {
    const p = Math.max(0, Math.min(chunk.length - WINDOW, Math.round(f * (chunk.length - WINDOW))))
    if (addon.bmSolve(Buffer.from(chunk.subarray(p, p + WINDOW))).length <= CAP) return true
  }
  return false
}

const evaluate = (label: string, chunks: Uint8Array[]) => {
  const scores = chunks.map(c => algebraicityScore(c))
  const hits = chunks.map(c => anyWindowFits(c))
  const hitRate = hits.filter(Boolean).length / hits.length
  console.log(`${label}: algebraicityScore avg=${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3)}  anyWindowFits hit-rate=${(hitRate * 100).toFixed(0)}%  (n=${chunks.length})`)
}

const noisyL3Region = new Uint8Array(fixture.buffer, fixture.byteOffset + 524288, 262144)
const noisyL3Chunks = sample(noisyL3Region, 30, 1)
evaluate("noisy L=3 algebraic (MUST have high hit-rate — this is the target domain)", noisyL3Chunks)

const textAll = Buffer.concat(textSources.map(f => readFileSync(f)))
const textBytes = new Uint8Array(textAll.buffer, textAll.byteOffset, textAll.byteLength)
const textChunks = sample(textBytes, 30, 2)
evaluate("real text/code (want LOW hit-rate — safe to skip)", textChunks)

const randomBig = Uint8Array.from({ length: 200 * 1024 }, () => Math.floor(Math.random() * 256))
const randomChunks = sample(randomBig, 30, 3)
evaluate("true random (want LOW hit-rate — safe to skip)", randomChunks)
