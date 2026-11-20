// Experimento 11 — ¿el éxito de B5 (afín8∘beatty) depende de j = s − v2(a)? (etiquetas SOLO para el análisis)
import { makeComposed } from "../src/lab/hidden-compose"
import { prng } from "../src/lab/bits"
import { discoverCompose } from "../src/lab/compose"
import { evalVec } from "../src/lab/ast"
import * as zlib from "zlib"

const N = 1 << 16, FAR = 1 << 20
const tz = (a: number) => (a === 0 ? 32 : 31 - Math.clz32(a & -a))
const brotli = (y: Uint8Array) => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
console.log("inst | s  v2(a)  j | resultado | ruta")
for (let k = 1; k <= 10; k++) {
  const seed = 3000 + k
  const r = prng(seed * 6007 + "B".charCodeAt(0) * 7919 + 5 * 104729)
  const a = r(); r(); const s = r() % 13, j = s - tz(a)
  const hid = makeComposed("B5", seed), y = hid.train(N)
  const d = discoverCompose(y, { maxDepth: 3, ms: 8000 })
  let res = "FALLO"
  if (d) {
    const v = evalVec(d.node, FAR); let exact = true
    for (let n = N; n < FAR && exact; n++) if (v[n] !== hid.eval(n)) exact = false
    const acc = d.cost < 0.25 * Math.min(brotli(y), 8 * N)
    res = acc ? (exact ? "DESCUBIERTA" : "sobreajuste") : exact ? "exacta-no-aceptada" : "fallo"
  }
  console.log(`#${String(k).padEnd(3)} | s=${String(s).padStart(2)} v2=${tz(a)} j=${String(j).padStart(2)} | ${res.padEnd(18)} | ${d ? d.path.join(">").slice(0, 70) : "-"}`)
}
