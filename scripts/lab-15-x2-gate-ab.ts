// A/B limpio: ¿la baja de X2 entre los lotes C y D la causa el control de il2 o las semillas?
// Mismas semillas, ambos controles (legacy = lote C; bound = lote D).
import { makeHidden } from "../src/lab/hidden-gen"
import { discoverCompose } from "../src/lab/compose"
import { evalVec } from "../src/lab/ast"
import * as zlib from "zlib"

const N = 1 << 16, FAR = 1 << 20
const brotli = (y: Uint8Array) => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
for (const base of [2000, 3000]) {
  for (const gate of ["legacy", "bound"] as const) {
    let desc = 0, ms = 0
    for (let k = 1; k <= 10; k++) {
      const hid = makeHidden("X2", base + k), y = hid.train(N)
      const d = discoverCompose(y, { maxDepth: 3, ms: 8000, il2Gate: gate })
      if (!d) continue
      ms += d.ms
      const v = evalVec(d.node, FAR); let exact = true
      for (let n = N; n < FAR && exact; n++) if (v[n] !== hid.eval(n)) exact = false
      if (exact && d.cost < 0.25 * Math.min(brotli(y), 8 * N)) desc++
    }
    console.log(`X2 semillas ${base + 1}-${base + 10} control=${gate.padEnd(6)} descubiertas ${desc}/10  (tiempo medio ${(ms / 10).toFixed(0)} ms)`)
  }
}
