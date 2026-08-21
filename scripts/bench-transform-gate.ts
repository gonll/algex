// Diagnoses why shouldTryTransforms lets non-algebraic real content through to
// the expensive delta/interleave/bitplane search (found via profiling: the
// delta loop was the single largest cost bucket on mixed content). Breaks the
// two-stage gate apart to see which stage is the leak.
//
// Finding: gate 1 (entropy) passes 100% of real text/code here — order-0
// Huffman on source code (many distinct identifiers/punctuation) rarely dips
// below 60% of raw size, so it's a much weaker filter for code than for prose.
// Gate 2 (algebraicity) passes 84-100% on ALL THREE categories tested,
// including true random — its 16-byte half-window slope heuristic saturates
// at short windows (random 8-byte halves tend to need a similarly-high BM
// order on both sides, giving a falsely low slope), so ALGEBRAICITY_GATE=0.35
// barely discriminates at this chunk size.
//
// Conclusion: NOT fixed here. Followed this further (see conversation, not
// committed as code) — the actual runtime cost concentrates in interleave/
// bitplane LANES, not top-level chunks. Those lanes are already pre-filtered
// by laneIsStructured (a single 20-byte window at the lane's start, cap L<=5,
// including its delta-transformed variants) before encodeLane ever runs, so
// by the time a lane reaches the approx-ladder gate added for the top-level
// case, it's already a lane that passed a near-identical filter — the
// remaining "waste" is baked into laneIsStructured's own precision, not an
// independent gap. Tightening laneIsStructured risks the exact regression
// Priority 6 was built to catch (arithmetic counters that only look linear
// post-delta) and would need its own dedicated calibration round against
// real lane-level noisy-algebraic data, not a quick patch. Left as a known,
// bounded inefficiency rather than risk that regression for an unclear win.

import { readFileSync } from "fs"
import { huffmanEstimate, rawCost, algebraicityScore, shouldTryTransforms } from "../src/core/transform"

const CHUNK = 4096
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const chunksOf = (buf: Uint8Array, size: number): Uint8Array[] => {
  const out: Uint8Array[] = []
  for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size))
  return out
}

const evaluate = (label: string, chunks: Uint8Array[]) => {
  let gate1Pass = 0, gate2Pass = 0, bothPass = 0
  for (const c of chunks) {
    const g1 = huffmanEstimate(c) > 0.60 * rawCost(c)   // "not already compressible" — must be true to proceed
    const g2 = algebraicityScore(c) <= 0.35              // "looks structured" — must be true to proceed
    if (g1) gate1Pass++
    if (g2) gate2Pass++
    if (g1 && g2) bothPass++
  }
  const n = chunks.length
  console.log(`${label} (n=${n}):`)
  console.log(`  gate 1 (entropy, "not compressible") pass rate: ${(gate1Pass / n * 100).toFixed(0)}%`)
  console.log(`  gate 2 (algebraicity, "looks structured") pass rate: ${(gate2Pass / n * 100).toFixed(0)}%`)
  console.log(`  BOTH pass (shouldTryTransforms=true, triggers full delta/interleave search): ${(bothPass / n * 100).toFixed(0)}%`)
}

const textSources = ["README.md", "src/codec/encoder.ts", "src/codec/chunker.ts", "src/codec/format.ts", "src/codec/candidates.ts", "src/core/pade.ts"]
const textAll = Buffer.concat(textSources.map(f => readFileSync(f)))
const textBytes = new Uint8Array(textAll.buffer, textAll.byteOffset, textAll.byteLength)
evaluate("real text/code", chunksOf(textBytes, CHUNK))

const rng = mulberry32(7)
const randomBytes = Uint8Array.from({ length: 100 * 1024 }, () => Math.floor(rng() * 256))
evaluate("true random", chunksOf(randomBytes, CHUNK))

// Sanity check: does the real fixture's noisy L=3 segment still pass (must stay true)?
const fixture = readFileSync("test/gf-structured.bin")
const noisyL3 = new Uint8Array(fixture.buffer, fixture.byteOffset + 524288, 262144)
evaluate("noisy L=3 algebraic (MUST mostly fail gate 2 -- transforms shouldn't be needed here since the plain LFSR search already wins, but must not silently mis-gate)", chunksOf(noisyL3, CHUNK))
