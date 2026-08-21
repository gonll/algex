// Calibrates a precision fix for laneIsStructured (encoder.ts) and, further
// down, for searchLFSRCandidates' anyWindowLooksAlgebraic gate -- using the
// real-world corpus (test/real-world.bin, see gen-real-world-file.ts) instead
// of only synthetic text/random, per the dedicated calibration round flagged
// as needed in scripts/bench-transform-gate.ts.
//
// Hypothesis: a single local window match is too easy to hit by coincidence
// in real non-algebraic content (repeated bytes, common opcodes, whitespace),
// so it doesn't reject much. Fix candidate: require the SAME fit (order AND
// coefficients) to ALSO hold at a second, distant window -- true structure
// (LFSR/PRBS/counter) is consistent everywhere; a local coincidence in real
// data essentially never repeats identically somewhere else by chance.
//
// RESULT: hypothesis disproven, fix rejected.
//   - laneIsStructured is ALREADY precise on real content: only 1% of real
//     compiled-binary lanes pass it (vs "want: mostly reject" -- already
//     true). The 2-window fix only pushes that to 0%, saving nothing
//     measurable, while dropping the fixture's noisy L=3 acceptance from 73%
//     to 49% -- a real coverage loss on the codec's actual target domain for
//     no real gain. Not worth it.
//   - anyWindowLooksAlgebraic (the approx-ladder gate) is similarly already
//     precise at LANE size (512B): 9% on real text, 4% on real binaries --
//     nothing like the 97% seen in this session's earlier full-pipeline
//     profiling run. That 97% figure was measured on lanes that had ALREADY
//     passed laneIsStructured's own pre-filter (a biased, pre-selected
//     population that naturally scores higher on a similar downstream test),
//     not on a representative sample -- there was no real leak at this gate
//     either, just a selection-bias artifact in how the original profiling
//     was read.
//
// Conclusion: both gates are already reasonably calibrated against real
// content. The remaining "waste" identified in profiling is bounded by how
// selective laneIsStructured already is (1-9% pass on unfiltered real
// samples) -- there isn't a large safe win left to extract here. Recommend
// NOT changing these gates further without a fundamentally different
// approach (not just tighter thresholds on the same window-sampling idea).

import { readFileSync } from "fs"
import { addon } from "../src/native/addon"
import { DELTA_TRANSFORMS } from "../src/core/transform"

const WINDOW = 20
const CAP = 5

const fitsEqual = (a: { length: number; coeffs: number[] }, b: { length: number; coeffs: number[] }): boolean =>
  a.length === b.length && a.coeffs.every((c, i) => c === b.coeffs[i])

// Current production behavior.
const laneIsStructuredV1 = (lane: Uint8Array): boolean => {
  if (lane.length < 4) return false
  const window = lane.subarray(0, Math.min(lane.length, WINDOW))
  if (addon.bmSolve(Buffer.from(window)).length <= CAP) return true
  return DELTA_TRANSFORMS.some(dt => addon.bmSolve(Buffer.from(dt.apply(window))).length <= CAP)
}

// Candidate fix: require the fit to reproduce at a second, far window. `skip`
// is 1 for delta-transformed buffers, whose out[0]=x[0] convention always
// leaves one raw (non-delta) seed byte at position 0 -- comparing a window
// that includes it against a window that doesn't is an apples-to-oranges
// false rejection, not a real precision signal.
const laneIsStructuredV2 = (lane: Uint8Array): boolean => {
  if (lane.length < 4) return false
  const check = (buf: Uint8Array, skip: number): boolean => {
    const w = Math.min(buf.length - skip, WINDOW)
    if (w < 4) return false
    const fit1 = addon.bmSolve(Buffer.from(buf.subarray(skip, skip + w)))
    if (fit1.length > CAP) return false
    if (buf.length - skip <= 2 * w) return true // too short to cross-verify -- fall back to the old, safe behavior
    const fit2 = addon.bmSolve(Buffer.from(buf.subarray(buf.length - w)))
    return fitsEqual(fit1, fit2)
  }
  if (check(lane, 0)) return true
  return DELTA_TRANSFORMS.some(dt => check(dt.apply(lane), 1))
}

const chunksOf = (buf: Uint8Array, size: number): Uint8Array[] => {
  const out: Uint8Array[] = []
  for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size))
  return out
}

const evaluate = (label: string, lanes: Uint8Array[], want: "accept" | "reject") => {
  const v1 = lanes.filter(laneIsStructuredV1).length
  const v2 = lanes.filter(laneIsStructuredV2).length
  console.log(`${label} (n=${lanes.length}, want ${want}):`)
  console.log(`  v1 (current):  ${(v1 / lanes.length * 100).toFixed(0)}% accept`)
  console.log(`  v2 (2-window): ${(v2 / lanes.length * 100).toFixed(0)}% accept`)
}

// Real compiled binaries -- split into lane-sized (~512B, matching interleave
// m=4/bitplane-scale) pieces the way the codec actually would.
const real = readFileSync("test/real-world.bin")
const realBytes = new Uint8Array(real.buffer, real.byteOffset, real.byteLength)
const binaryLanes = chunksOf(realBytes.subarray(262144), 512) // the real-binary region
evaluate("real compiled binaries", binaryLanes, "reject")

// Real PRBS lanes -- orders 7/15/23/31 all exceed CAP=5 by design (this gate
// only screens for LOW-order lane structure; the true PRBS order is found by
// the uncapped top-level searchLFSRCandidates/findBestPade path instead), so
// "reject" here is the CORRECT and expected outcome, not evidence of a leak.
const prbsLanes = chunksOf(realBytes.subarray(0, 262144), 512)
evaluate("real PRBS7/15/23/31 (correctly out of scope for this gate)", prbsLanes, "reject")

// Genuine counter / sequence-number pattern (e.g. a packet sequence-number
// field incrementing each record) -- realistic firmware/protocol content.
const counterLanes: Uint8Array[] = []
for (let base = 0; base < 50; base++) {
  const lane = new Uint8Array(512)
  for (let i = 0; i < 512; i++) lane[i] = (base * 7 + i) & 0xff
  counterLanes.push(lane)
}
evaluate("synthetic counter/sequence-number data", counterLanes, "accept")

// Fixture's noisy L=3 segment.
const fixture = readFileSync("test/gf-structured.bin")
const noisyL3 = new Uint8Array(fixture.buffer, fixture.byteOffset + 524288, 262144)
const noisyLanes = chunksOf(noisyL3, 512)
evaluate("fixture noisy L=3 algebraic (2% noise)", noisyLanes, "accept")

// ── Now test the SAME 2-window idea against the OTHER gate (searchLFSRCandidates'
// anyWindowLooksAlgebraic, 9-sample OR logic) -- that's the one whose 97% pass
// rate on lane-sized real TEXT was the actual observed leak in profiling,
// not laneIsStructured (which real binaries already show is fine).
console.log("\n--- anyWindowLooksAlgebraic (9-sample OR) vs a require-2-hits variant ---")

const FRACTIONS = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]
const anyWindowV1 = (buf: Uint8Array): boolean => {
  const n = buf.length
  if (n <= WINDOW) return true
  for (const f of FRACTIONS) {
    const p = Math.max(0, Math.min(n - WINDOW, Math.round(f * (n - WINDOW))))
    if (addon.bmSolve(Buffer.from(buf.subarray(p, p + WINDOW))).length <= CAP) return true
  }
  return false
}
// Require at least 2 of the 9 samples to hit, and with matching coefficients
// (not just independently low order) -- a real global fit should agree with
// itself across samples; independent local coincidences in text shouldn't.
const anyWindowV3 = (buf: Uint8Array): boolean => {
  const n = buf.length
  if (n <= WINDOW) return true
  const hits: { length: number; coeffs: number[] }[] = []
  for (const f of FRACTIONS) {
    const p = Math.max(0, Math.min(n - WINDOW, Math.round(f * (n - WINDOW))))
    const fit = addon.bmSolve(Buffer.from(buf.subarray(p, p + WINDOW)))
    if (fit.length <= CAP) hits.push(fit)
  }
  if (hits.length < 2) return false
  return hits.some((a, i) => hits.slice(i + 1).some(b => fitsEqual(a, b)))
}

const evaluate2 = (label: string, bufs: Uint8Array[]) => {
  const v1 = bufs.filter(anyWindowV1).length
  const v3 = bufs.filter(anyWindowV3).length
  console.log(`${label} (n=${bufs.length}): v1=${(v1 / bufs.length * 100).toFixed(0)}%  v3(2-hit-agree)=${(v3 / bufs.length * 100).toFixed(0)}%`)
}

const textSources = ["README.md", "src/codec/encoder.ts", "src/codec/chunker.ts", "src/codec/format.ts", "src/codec/candidates.ts", "src/core/pade.ts"]
const textAll = Buffer.concat(textSources.map(f => readFileSync(f)))
const textBytes = new Uint8Array(textAll.buffer, textAll.byteOffset, textAll.byteLength)
const textLanes512 = chunksOf(textBytes, 512)
evaluate2("real text/code, 512B lanes (want low)", textLanes512)
evaluate2("real compiled binaries, 512B lanes (want low)", binaryLanes)
evaluate2("fixture noisy L=3, 512B lanes (want high -- must not regress)", noisyLanes)
const counterBufs512 = counterLanes // already 512B
evaluate2("synthetic counter (raw, no delta -- want low, this gate doesn't delta-wrap)", counterBufs512)
