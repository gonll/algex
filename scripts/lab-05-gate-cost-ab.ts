// Experimento 05 — costo A/B del candidato bit-lfsr en datos reales NO algebraicos (chunks de 4 KB reales del pipeline).
// Mide encode() con y sin enableBitLfsr; el tamaño debe ser idéntico (el candidato no debe ganar donde no hay estructura).
//   npx tsx scripts/lab-05-gate-cost-ab.ts
import * as fs from "fs"
import { encode } from "../src/codec/encoder"
import { serialize } from "../src/codec/format"
import { DEFAULT_BUDGET } from "../src/codec/search-budget"

const files: string[] = []
for (const d of ["firmware", "image", "pcap"]) for (const f of fs.readdirSync(`test/real-data/${d}`)) files.push(`test/real-data/${d}/${f}`)
const run = (enable: boolean) => {
  let ms = 0, size = 0
  for (const f of files) {
    const buf = new Uint8Array(fs.readFileSync(f).subarray(0, 1 << 20))
    const t = performance.now(); const file = encode(buf, { ...DEFAULT_BUDGET, enableBitLfsr: enable }); ms += performance.now() - t
    size += serialize(file).length
  }
  return { ms, size }
}
run(true) // warmup
for (let r = 0; r < 3; r++) {
  const off = run(false), on = run(true)
  console.log(`ronda ${r + 1}: sin ${off.ms.toFixed(0)}ms/${off.size}B | con ${on.ms.toFixed(0)}ms/${on.size}B | sobrecosto ${(100 * (on.ms / off.ms - 1)).toFixed(1)}% | tamaño ${on.size === off.size ? "idéntico" : "DISTINTO " + (on.size - off.size)}`)
}
