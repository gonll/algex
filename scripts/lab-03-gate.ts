// Experimento 03 — puerta de rechazo para candidatos bit-LFSR sobre datos REALES.
// Puerta: BM sobre GF(2) en K ventanas de W bits repartidas por el chunk, ambos órdenes de bit;
// pasa si alguna ventana tiene L <= GATE_L. Luego (solo si pasa) síntesis completa + residual.
//   npx tsx scripts/lab-03-gate.ts
import * as fs from "fs"
import * as path from "path"
import { bytesToBits, bitsToBytes } from "../src/lab/bits"
import { synthLfsr2, genLfsr2, costLfsr2 } from "../src/lab/lfsr2"
import * as zlib from "zlib"
import { synthNoisyLfsr2, costNoisyLfsr2, noisyGate } from "../src/lab/lfsr2-noisy"
import { compress } from "../src/index"

const CHUNK = 32 * 1024
const W = 1024, GATE_L = 128
const FRACS = [0, 0.33, 0.66, 1]
const now = () => performance.now()

const gate = (bits: Uint8Array): boolean => {
  for (const f of FRACS) {
    const p = Math.round(f * (bits.length - W))
    let ones = 0; for (let i = p; i < p + W; i++) ones += bits[i]!
    if (ones === 0 || ones === W) continue // ventana constante: ya la cubre Algex
    if (synthLfsr2(bits.subarray(p, p + W), GATE_L)) return true
  }
  return false
}

const root = "test/real-data"
const files: string[] = []
for (const d of fs.readdirSync(root)) {
  const dp = path.join(root, d)
  if (fs.statSync(dp).isDirectory()) for (const f of fs.readdirSync(dp)) files.push(path.join(dp, f))
}
console.log("archivo                              | chunks | gate ms/chunk | pasan | aceptados(exacto) | ruidoso ms/chunk | acept.ruidoso | Algex ms/chunk (muestra) | gate/Algex")
let totGateMs = 0, totChunks = 0, totPass = 0, totAlgexMs = 0, totAlgexChunks = 0
for (const f of files) {
  const buf = new Uint8Array(fs.readFileSync(f))
  const n = Math.floor(buf.length / CHUNK) + (buf.length % CHUNK >= 4096 ? 1 : 0)
  let gPass = 0, gMs = 0, pass = 0, acc = 0, nMs = 0, nAcc = 0, nSamp = 0, aMs = 0, aN = 0
  for (let c = 0; c < n; c++) {
    const ch = buf.subarray(c * CHUNK, Math.min(buf.length, (c + 1) * CHUNK))
    if (ch.length * 8 < 4 * W) continue
    const t0 = now()
    let passed = false
    const bitsBy = [true, false].map((m) => bytesToBits(ch, m))
    for (const bits of bitsBy) if (gate(bits)) { passed = true; break }
    gMs += now() - t0
    let alt = Infinity
    const getAlt = () => { if (alt === Infinity) alt = Math.min(compress(Uint8Array.from(ch)).length, zlib.brotliCompressSync(ch, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length); return alt }
    if (passed) {
      pass++
      for (let k = 0; k < 2; k++) {
        const msb = k === 0, m = synthLfsr2(bitsBy[k]!, 4096)
        if (m && Math.ceil(costLfsr2(m) / 8) + 1 < getAlt() &&
            Buffer.compare(Buffer.from(bitsToBytes(genLfsr2(m), msb)), Buffer.from(ch)) === 0) { acc++; break }
      }
    }
    if (c < 8) { // muestra: costo del camino ruidoso (sin puerta) y de Algex
      nSamp++
      const t1 = now(); let ok = false
      for (const bits of bitsBy) { if (!noisyGate(bits)) continue; gPass++; const m = synthNoisyLfsr2(bits, 4096); if (m && costNoisyLfsr2(m) / 8 + 1 < getAlt()) ok = true }
      nMs += now() - t1; if (ok) nAcc++
      const t2 = now(); compress(Uint8Array.from(ch)); aMs += now() - t2; aN++
    }
  }
  totGateMs += gMs; totChunks += n; totPass += pass
  totAlgexMs += aMs; totAlgexChunks += aN
  const gPer = gMs / n, aPer = aN ? aMs / aN : NaN
  console.log(`${f.replace("test/real-data/", "").padEnd(36)} | ${String(n).padStart(6)} | ${gPer.toFixed(2).padStart(13)} | ${String(pass).padStart(5)} | ${String(acc).padStart(17)} | ${(nSamp ? nMs / nSamp : NaN).toFixed(1).padStart(16)} | ${String(nAcc).padStart(3)}/${nSamp} (gate ${gPass}) | ${aPer.toFixed(1).padStart(24)} | ${(100 * gPer / aPer).toFixed(1)}%`)
}
console.log(`\nTOTAL chunks=${totChunks} gate=${(totGateMs / totChunks).toFixed(2)} ms/chunk pasan=${totPass} Algex(muestra)=${(totAlgexMs / totAlgexChunks).toFixed(1)} ms/chunk`)
