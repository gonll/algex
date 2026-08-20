// Roadmap 2, Priority 5: residual context modeling — verdict, NOT enabled.
//
// Hypothesis: residual bytes can themselves contain structure, so applying a
// secondary delta transform (XOR-1, ADD-1, XOR-2 — the same ones already used
// on the main data) to the residual BEFORE packing might shrink it further.
//
// Result: delta-transforming a residual converts each ISOLATED non-zero byte
// into a PAIR of non-zero bytes (one at the original position, one at the
// following position where the delta "un-cancels"), which roughly doubles
// effective sparse density for the common case — a real residual from an
// LFSR/cyclic fit is sparse by construction (that's what makes the fit
// worthwhile), so this reliably makes things worse, not better. It only wins
// for a narrow, contrived case (a short-period repeating XOR mask at sparse
// positions), and loses meaningfully everywhere else tested below, including
// dense residuals. Given production adoption would cost a wire-format change
// (an extra flag distinguishing delta-transformed residuals) for a technique
// that loses on the representative case, this is not wired into production —
// see the "Rejected ideas" section of the final report.

import { deflateRawSync, brotliCompressSync, constants } from "zlib"
import { packResidual, packSplitResidual, packRiceResidual, packBitmapResidual, packRLEResidual } from "../src/utils/sparse"
import { deltaXor1Apply, deltaAdd1Apply, deltaXor2Apply } from "../src/core/transform"

const sizeOf = (packed: Uint8Array) => {
  const d = deflateRawSync(packed, { level: 9 }).length + 5
  const b = brotliCompressSync(packed, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length + 5
  const p = packed.length + 1
  return Math.min(d, b, p)
}
const bestOf = (r: Uint8Array) => Math.min(
  sizeOf(packResidual(r)),
  ...[packSplitResidual(r), packRiceResidual(r), packBitmapResidual(r), packRLEResidual(r)]
    .filter((x): x is Uint8Array => !!x).map(sizeOf)
)

const lcg = (seed: number) => { let s = seed; return () => { s = (s*1103515245+12345)&0x7fffffff; return s/0x7fffffff } }

const scenarios: [string, Uint8Array][] = []

// Sparse scattered
{
  const rng = lcg(1)
  const r = new Uint8Array(4096)
  for (let i=0;i<r.length;i++) if (rng()<0.02) r[i]=1+Math.floor(rng()*255)
  scenarios.push(["sparse 2%", r])
}
// Dense (60%)
{
  const rng = lcg(2)
  const r = new Uint8Array(4096)
  for (let i=0;i<r.length;i++) if (rng()<0.6) r[i]=1+Math.floor(rng()*255)
  scenarios.push(["dense 60%", r])
}
// Constant value at sparse positions (repeated XOR mask)
{
  const rng = lcg(3)
  const r = new Uint8Array(4096)
  for (let i=0;i<r.length;i++) if (rng()<0.05) r[i]=0xAB
  scenarios.push(["sparse constant-value 5%", r])
}
// Slowly changing values (correlated with neighbors)
{
  const r = new Uint8Array(4096)
  let v = 10
  for (let i=0;i<r.length;i++) { if (i%7===0) { v = (v+3)&0xff; r[i] = v || 1 } }
  scenarios.push(["slowly-changing sparse", r])
}
// Alternating values
{
  const r = new Uint8Array(4096)
  for (let i=0;i<r.length;i+=3) r[i] = (i%6===0) ? 0x11 : 0x22
  scenarios.push(["alternating sparse", r])
}

for (const [name, r] of scenarios) {
  const base = bestOf(r)
  const deltas = [
    ["xor1", deltaXor1Apply(r)],
    ["add1", deltaAdd1Apply(r)],
    ["xor2", deltaXor2Apply(r)],
  ] as const
  const results = deltas.map(([id, dr]) => [id, bestOf(dr)] as const)
  const bestDelta = results.reduce((a,b) => b[1]<a[1]?b:a)
  console.log(`${name.padEnd(28)} base=${base}  bestDelta=${bestDelta[0]}:${bestDelta[1]}  ${bestDelta[1]<base ? "WINS" : "loses"}`)
}
