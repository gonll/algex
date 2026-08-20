// PROTOTYPE ONLY — Priority 8, not wired into the production encoder/decoder.
//
// Classical Reed-Solomon-style syndrome decoding applied to a sparse residual:
// instead of storing (position, value) pairs directly, store 2t syndromes and
// let the decoder recover up to t error positions/magnitudes via Berlekamp-
// Massey (reusing the same native solver already used for LFSR detection) +
// Chien search + Forney's algorithm. Bounded to a single GF(256) block
// (residual length <= 255) since Chien search needs one field element per
// addressable position.
//
// Benchmark verdict (scripts/bench-syndrome.ts): syndrome coding wins by a
// thin 1-2 bytes over the best production format (VarInt/split/Rice) for
// sparse errors within one 255-byte block (t <= ~16), and loses increasingly
// once error density climbs — its cost is a flat 2t regardless of how the
// positions/values are distributed, so it captures none of the wins Rice
// coding gets from favorable (skewed/clustered) gap distributions. Real chunk
// residuals in this codec are typically 512-4096 bytes, well past the
// 255-byte single-block limit, so using this in production would require
// splitting each residual into multiple sub-blocks — each paying its own
// [2]twoT header — which would erode most or all of the thin per-block win.
// Not enabled in production; kept as a correctness-verified prototype per the
// project's evidence-based acceptance criteria for this priority.

import { gfMul, gfAdd, gfInv } from "../utils/gf256"
import { addon } from "../native/addon"

export const MAX_BLOCK_LENGTH = 255  // GF(256) has 255 nonzero elements
const ALPHA = 3                       // primitive element used to build gf256's log/exp tables

const gfPow = (base: number, exp: number): number => {
  let e = ((exp % 255) + 255) % 255
  let result = 1
  let b = base
  while (e > 0) {
    if (e & 1) result = gfMul(result, b)
    b = gfMul(b, b)
    e >>= 1
  }
  return result
}

// Encode: compute 2t syndromes from known error positions/values.
// twoT must be >= 2 * actual error count or decoding will fail to recover them.
export const computeSyndromes = (
  positions: readonly number[],
  values: readonly number[],
  twoT: number
): number[] => {
  const syndromes = new Array<number>(twoT).fill(0)
  const X = positions.map(p => gfPow(ALPHA, p))
  for (let j = 1; j <= twoT; j++) {
    let s = 0
    for (let i = 0; i < positions.length; i++) s = gfAdd(s, gfMul(values[i]!, gfPow(X[i]!, j)))
    syndromes[j - 1] = s
  }
  return syndromes
}

// Evaluate a polynomial (coeffs[0] = constant term) at Xinv via Horner's method
// using increasing powers of Xinv (coeffs ordered low-to-high degree).
const evalLowToHigh = (coeffs: readonly number[], xInv: number): number => {
  let acc = 0
  let xp = 1
  for (const c of coeffs) { acc = gfAdd(acc, gfMul(c, xp)); xp = gfMul(xp, xInv) }
  return acc
}

// Decode: recover (position, value) pairs from syndromes + the known block length.
// Returns null when the syndromes don't factor cleanly (insufficient twoT, or
// corrupt data) — this must never silently return a wrong/partial result.
export const decodeSyndromes = (
  syndromes: readonly number[],
  length: number
): { position: number; value: number }[] | null => {
  const twoT = syndromes.length
  if (twoT === 0) return []

  // Berlekamp-Massey over the syndrome sequence recovers the error locator
  // polynomial Lambda(x) = 1 + c1 x + ... + cL x^L — the same algorithm already
  // used elsewhere in this codebase for byte-sequence LFSR detection, applied
  // here to syndromes (this equivalence is the standard RS decoding step).
  const { length: L, coeffs } = addon.bmSolve(Buffer.from(syndromes))
  if (L === 0) return []                 // no errors
  if (2 * L > twoT) return null          // more errors than these syndromes can resolve

  const lambda = [1, ...coeffs]  // low-to-high degree: lambda[0]=1, lambda[k]=coeffs[k-1]

  // Chien search: X_p = alpha^p is a root of Lambda iff Lambda(1/X_p) == 0.
  const roots: number[] = []
  for (let p = 0; p < length && roots.length < L; p++) {
    const xInv = gfPow(ALPHA, -p)
    if (evalLowToHigh(lambda, xInv) === 0) roots.push(p)
  }
  if (roots.length !== L) return null

  // Error evaluator: Omega(x) = [S(x) * Lambda(x)] mod x^twoT,
  // S(x) = sum_{j=1..twoT} S_j x^(j-1).
  const omega = new Array<number>(twoT).fill(0)
  for (let i = 0; i < twoT; i++) {
    for (let k = 0; k < lambda.length && i - k >= 0; k++) {
      omega[i] = gfAdd(omega[i]!, gfMul(lambda[k]!, syndromes[i - k]!))
    }
  }

  // Formal derivative of Lambda in characteristic 2: only odd-degree terms
  // survive (their coefficient's multiplier k is odd, i.e. == 1 in GF(2)), and
  // Lambda'(x) = sum_{k odd} Lambda_k x^(k-1) = sum_j Lambda_(2j+1) (x^2)^j —
  // i.e. lambdaOdd evaluated at x^2, not at x itself.
  const lambdaOdd: number[] = []
  for (let k = 1; k < lambda.length; k += 2) lambdaOdd.push(lambda[k]!)

  const result: { position: number; value: number }[] = []
  for (const p of roots) {
    const xInv = gfPow(ALPHA, -p)
    const omegaAt = evalLowToHigh(omega, xInv)
    const denom   = evalLowToHigh(lambdaOdd, gfMul(xInv, xInv))
    if (denom === 0) return null  // degenerate — reject rather than guess
    result.push({ position: p, value: gfMul(omegaAt, gfInv(denom)) })
  }
  return result.sort((a, b) => a.position - b.position)
}

// Wire-size estimate for a syndrome-encoded residual: [2]twoT + twoT syndrome
// bytes (no position/value data needed — the syndromes encode both).
export const syndromeWireSize = (twoT: number): number => 2 + twoT
