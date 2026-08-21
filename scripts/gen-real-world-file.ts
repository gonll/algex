// Builds a real-world (non-synthetic) test corpus, unlike gen-gf-file.ts's
// hand-crafted GF(256) recurrences and this session's own text+random
// benchmarks. Two genuinely real sources:
//
//   1. ITU-T O.150 standard PRBS test patterns (PRBS7/15/23/31) — the actual
//      bit-serial pseudorandom sequences used by real SONET/SDH/Ethernet/USB/
//      PCIe conformance test equipment, generated from the standard Fibonacci
//      LFSR polynomials and packed MSB-first into bytes the way real BERT
//      (bit error rate tester) hardware would. This is public, standardized
//      math — not fetched from anywhere, not invented for this codec.
//   2. Slices of real compiled binaries already on this machine (a Windows
//      system DLL, a system EXE, and this project's own native addon) —
//      genuine machine code and data sections, standing in for "firmware"
//      without needing network access or licensing concerns (read locally,
//      used locally, not redistributed).
//
// Whether the codec's byte-level GF(256) LFSR model actually matches
// real *bit-level* PRBS (packed into bytes) is itself an open question this
// file exists to test — the codec's own synthetic fixture uses byte-level
// "PRBS-8" generators, which is a different (and possibly easier) model than
// genuine bit-serial PRBS repacked into bytes.

import { readFileSync, writeFileSync } from "fs"

// Standard Fibonacci LFSR PRBS generators (ITU-T O.150 polynomials).
// Bit stream generated MSB-first, packed 8 bits/byte.
const PRBS_POLYS: Record<string, { order: number; taps: number[] }> = {
  prbs7:  { order: 7,  taps: [7, 6] },        // x^7  + x^6  + 1
  prbs15: { order: 15, taps: [15, 14] },      // x^15 + x^14 + 1
  prbs23: { order: 23, taps: [23, 18] },      // x^23 + x^18 + 1
  prbs31: { order: 31, taps: [31, 28] },      // x^31 + x^28 + 1
}

const genPRBS = (name: string, nBytes: number): Uint8Array => {
  const { order, taps } = PRBS_POLYS[name]!
  const mask = order === 31 ? 0x7fffffff : (1 << order) - 1
  let state = 1 // any nonzero seed
  const out = new Uint8Array(nBytes)
  for (let i = 0; i < nBytes; i++) {
    let byte = 0
    for (let b = 0; b < 8; b++) {
      let fb = 0
      for (const t of taps) fb ^= (state >>> (t - 1)) & 1
      state = ((state << 1) | fb) >>> 0 & mask
      if (state === 0) throw new Error(`${name}: LFSR degenerated to all-zero state — tap/seed bug`)
      byte = (byte << 1) | fb
    }
    out[i] = byte
  }
  return out
}

const readSlice = (path: string, start: number, len: number): Uint8Array => {
  const b = readFileSync(path)
  const end = Math.min(b.length, start + len)
  return new Uint8Array(b.buffer, b.byteOffset + start, end - start)
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

const K = 1024
const segments = [
  { label: "PRBS7  (real ITU-T O.150, bit-serial, byte-packed)", data: genPRBS("prbs7", 64 * K) },
  { label: "PRBS15 (real ITU-T O.150, bit-serial, byte-packed)", data: genPRBS("prbs15", 64 * K) },
  { label: "PRBS23 (real ITU-T O.150, bit-serial, byte-packed)", data: genPRBS("prbs23", 64 * K) },
  { label: "PRBS31 (real ITU-T O.150, bit-serial, byte-packed)", data: genPRBS("prbs31", 64 * K) },
  { label: "kernel32.dll slice (real Windows system binary)",    data: readSlice("C:/Windows/System32/kernel32.dll", 4096, 128 * K) },
  { label: "notepad.exe slice (real Windows system binary)",     data: readSlice("C:/Windows/System32/notepad.exe", 4096, 128 * K) },
  { label: "pade_compress_addon.node (real project build artifact)", data: readSlice("build/Release/pade_compress_addon.node", 0, 188 * K) },
]

const file = concat(...segments.map(s => s.data))
writeFileSync("test/real-world.bin", file)

console.log(`Written test/real-world.bin (${(file.length / K).toFixed(0)} KB):`)
for (const s of segments) console.log(`  ${(s.data.length / K).toFixed(0).padStart(4)} KB  ${s.label}`)
