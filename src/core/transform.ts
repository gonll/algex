// Cost model, pre-gate heuristics, and delta transforms.
//
// Two-stage gate controls whether the transform search loop runs at all:
//   Gate 1 (entropy)      — rejects already-statistically-compressible data
//                           (text, already-compressed formats, constant bytes)
//   Gate 2 (algebraicity) — rejects high-entropy but non-algebraic data
//                           (AES output, compressed media, genuine noise)
// Only data that is BOTH high-entropy AND algebraically structured passes,
// which is precisely the class that benefits from transform-based LFSR encoding.

import { addon } from "../native/addon"

export type Bits = number

// ── Cost model ────────────────────────────────────────────────────────────────

// Shannon entropy × N × 1.05 overhead factor (gzip/Huffman approximation).
// Correct formula: H(X)·N = -Σ f·log₂(f/N).  Returns bits.
export const huffmanEstimate = (x: Uint8Array): Bits => {
  const freq = new Uint32Array(256)
  for (const b of x) freq[b]++
  const n = x.length
  let bits = 0
  for (const f of freq) {
    if (f === 0) continue
    bits += -f * Math.log2(f / n)
  }
  return Math.ceil(bits * 1.05)
}

export const rawCost = (x: Uint8Array): Bits => x.length * 8

// Minimum achievable cost: a statistical codec (gzip) competes, not raw storage.
export const baselineCost = (x: Uint8Array): Bits =>
  Math.min(rawCost(x), huffmanEstimate(x))

// ── Algebraicity score ────────────────────────────────────────────────────────
//
// Measures how *consistently* a sequence's linear complexity behaves over
// short sliding windows.
//
// For each 16-byte window, compare the BM complexity of the first 8 bytes
// against the second 8 bytes:
//   • Pure LFSR  → L is identical in every window → max slope ≈ 0 → score ≈ 0
//   • Random     → L fluctuates window-to-window → max slope high → score → 1
//   • Structured but non-LFSR (e.g. counter) → consistent complexity → score ≈ 0
//
// Score ∈ [0, 1].  Low score = algebraically structured.  High = random-like.

const ALG_WINDOW = 16   // bytes per measurement window
const ALG_STEP   = 8    // slide step (half-window)
const ALG_PROBE  = 96   // max bytes to inspect (cheap: O(probe) BM calls)

export const algebraicityScore = (x: Uint8Array, probe = ALG_PROBE): number => {
  const len = Math.min(probe, x.length)
  if (len < ALG_WINDOW) return 0  // too short — assume structured

  let maxSlope = 0
  const half = ALG_WINDOW / 2
  for (let i = 0; i + ALG_WINDOW <= len; i += ALG_STEP) {
    const L0 = addon.bmSolve(Buffer.from(x.subarray(i,        i + half))).length
    const L1 = addon.bmSolve(Buffer.from(x.subarray(i + half, i + ALG_WINDOW))).length
    const slope = Math.abs(L1 - L0) / half
    if (slope > maxSlope) maxSlope = slope
  }
  // Normalise: pure random peaks around maxSlope ≈ 0.5; LFSR stays near 0.
  return Math.min(1, maxSlope / 0.5)
}

// ── Dual pre-gate ─────────────────────────────────────────────────────────────

// Fraction of rawCost that huffmanEstimate must exceed to proceed.
// Below this → already statistically compressible → outer gzip handles it.
const ENTROPY_GATE = 0.60

// Maximum algebraicity score allowed to proceed.
// Above this → data is too random-like for LFSR transforms to help.
const ALGEBRAICITY_GATE = 0.35

// True when a chunk is worth running the transform search pipeline on.
// Short-circuits on gate 1 (cheaper, O(N)) before gate 2 (BM calls).
export const shouldTryTransforms = (x: Uint8Array): boolean => {
  if (x.length < 16) return false
  if (huffmanEstimate(x) <= ENTROPY_GATE * rawCost(x)) return false  // gate 1
  return algebraicityScore(x) <= ALGEBRAICITY_GATE                   // gate 2
}

// ── Delta transform IDs (permanent — never reassign, never reuse) ─────────────
//
// Each ID corresponds to an entry in the wire format; retiring an ID must
// throw on decode, never silently reinterpret.

export const DELTA_XOR1_ID = 3   // XOR first difference:  z[i] = x[i] ^ x[i-1]
export const DELTA_ADD1_ID = 4   // ADD first difference:  z[i] = (x[i] - x[i-1]) mod 256
export const DELTA_XOR2_ID = 5   // XOR second difference: apply XOR-1 twice

// ── Delta apply / invert ──────────────────────────────────────────────────────

export const deltaXor1Apply = (x: Uint8Array): Uint8Array => {
  const out = new Uint8Array(x.length)
  if (x.length === 0) return out
  out[0] = x[0]!
  for (let i = 1; i < x.length; i++) out[i] = x[i]! ^ x[i - 1]!
  return out
}

export const deltaXor1Invert = (x: Uint8Array): Uint8Array => {
  const out = new Uint8Array(x.length)
  if (x.length === 0) return out
  out[0] = x[0]!
  for (let i = 1; i < x.length; i++) out[i] = x[i]! ^ out[i - 1]!
  return out
}

// ADD difference catches counter sequences linear over integers, not GF(2⁸).
export const deltaAdd1Apply = (x: Uint8Array): Uint8Array => {
  const out = new Uint8Array(x.length)
  if (x.length === 0) return out
  out[0] = x[0]!
  for (let i = 1; i < x.length; i++) out[i] = (x[i]! - x[i - 1]! + 256) & 0xff
  return out
}

export const deltaAdd1Invert = (x: Uint8Array): Uint8Array => {
  const out = new Uint8Array(x.length)
  if (x.length === 0) return out
  out[0] = x[0]!
  for (let i = 1; i < x.length; i++) out[i] = (x[i]! + out[i - 1]!) & 0xff
  return out
}

export const deltaXor2Apply  = (x: Uint8Array): Uint8Array => deltaXor1Apply(deltaXor1Apply(x))
export const deltaXor2Invert = (x: Uint8Array): Uint8Array => deltaXor1Invert(deltaXor1Invert(x))

// ── Transform table ───────────────────────────────────────────────────────────

export const DELTA_TRANSFORMS: ReadonlyArray<{
  readonly id: number
  readonly apply:  (x: Uint8Array) => Uint8Array
  readonly invert: (x: Uint8Array) => Uint8Array
}> = [
  { id: DELTA_XOR1_ID, apply: deltaXor1Apply, invert: deltaXor1Invert },
  { id: DELTA_ADD1_ID, apply: deltaAdd1Apply, invert: deltaAdd1Invert },
  { id: DELTA_XOR2_ID, apply: deltaXor2Apply, invert: deltaXor2Invert },
]
