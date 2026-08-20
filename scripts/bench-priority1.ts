// Deterministic benchmark corpus for Priority 1 (actual-size best-candidate selection).
// Seeded PRNG only — no Math.random() — so results are reproducible run to run.

import { encode, serialize, decompress } from "../src/index"
import { gfMul, gfAdd } from "../src/utils/gf256"

// mulberry32 — small deterministic PRNG
const mulberry32 = (seed: number) => {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const makeLN = (n: number, coeffs: number[], rng: () => number): Uint8Array => {
  const L = coeffs.length
  const buf = new Uint8Array(n)
  for (let i = 0; i < L; i++) buf[i] = Math.floor(rng() * 256)
  for (let i = L; i < n; i++) {
    let v = 0
    for (let j = 0; j < L; j++) v = gfAdd(v, gfMul(coeffs[j]!, buf[i - 1 - j]!))
    buf[i] = v
  }
  return buf
}

const addNoise = (buf: Uint8Array, rate: number, rng: () => number): Uint8Array => {
  const out = new Uint8Array(buf)
  for (let i = 0; i < buf.length; i++) {
    if (rng() < rate) out[i] = (out[i]! ^ (1 + Math.floor(rng() * 255))) & 0xff
  }
  return out
}

const cyclic = (period: number, n: number, rng: () => number): Uint8Array => {
  const cycle = Uint8Array.from({ length: period }, () => Math.floor(rng() * 256))
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = cycle[i % period]!
  return out
}

interface Dataset { name: string; data: Uint8Array }

const datasets: Dataset[] = []
{
  const rng = mulberry32(1)
  datasets.push({ name: "L1 exact (2KB)", data: makeLN(2048, [gfMul(1, 1) || 3], rng) })
}
{
  const rng = mulberry32(2)
  datasets.push({ name: "L3 exact (2KB)", data: makeLN(2048, [0x57, 0x2f, 0x11], rng) })
}
{
  const rng = mulberry32(3)
  datasets.push({ name: "L1 + 1% noise (2KB)", data: addNoise(makeLN(2048, [3], mulberry32(30)), 0.01, rng) })
}
{
  const rng = mulberry32(4)
  datasets.push({ name: "L3 + 5% noise (2KB)", data: addNoise(makeLN(2048, [0x57, 0x2f, 0x11], mulberry32(40)), 0.05, rng) })
}
{
  const rng = mulberry32(5)
  datasets.push({ name: "cyclic period 7 (2KB)", data: cyclic(7, 2048, rng) })
}
{
  const rng = mulberry32(6)
  datasets.push({ name: "cyclic period 64 + noise (2KB)", data: addNoise(cyclic(64, 2048, mulberry32(60)), 0.02, rng) })
}
{
  const rng = mulberry32(7)
  datasets.push({ name: "random (2KB)", data: Uint8Array.from({ length: 2048 }, () => Math.floor(rng() * 256)) })
}

let totalOrig = 0, totalComp = 0
for (const { name, data } of datasets) {
  const t0 = performance.now()
  const file = encode(data)
  const wire = serialize(file)
  const t1 = performance.now()
  const restored = decompress(wire)
  const ok = restored.length === data.length && restored.every((b, i) => b === data[i])
  totalOrig += data.length
  totalComp += wire.length
  const kinds = new Map<string, number>()
  for (const c of file.chunks) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
  const kindStr = [...kinds.entries()].map(([k, n]) => `${n}x${k}`).join(" ")
  console.log(
    `${name.padEnd(32)} ${String(data.length).padStart(6)} -> ${String(wire.length).padStart(6)}  ` +
    `(${((wire.length / data.length) * 100).toFixed(1)}%)  ${t1 - t0 | 0}ms  ${ok ? "OK" : "FAIL"}  [${kindStr}]`
  )
}
console.log(`\nTOTAL: ${totalOrig} -> ${totalComp}  (${((totalComp / totalOrig) * 100).toFixed(1)}%)`)
