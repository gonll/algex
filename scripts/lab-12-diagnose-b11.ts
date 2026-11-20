// Experimento 11 — diagnóstico de B11 (add(beatty,poly)) y B12 (poly∘beatty): ¿por qué el motor los resuelve?
// Reproduce los parámetros ocultos SOLO para etiquetar el análisis (el buscador no los ve).
import { makeComposed } from "../src/lab/hidden-compose"
import { prng } from "../src/lab/bits"
import { discoverCompose } from "../src/lab/compose"
import { evalVec, show } from "../src/lab/ast"

const FAR = 1 << 20, N = 1 << 16
const tz = (a: number) => (a === 0 ? 32 : 31 - Math.clz32(a & -a))
for (const cls of ["B11", "B12"] as const) {
  console.log(`\n=== ${cls} ===`)
  for (let k = 1; k <= 10; k++) {
    const seed = 1000 + k
    const r = prng(seed * 6007 + cls.charCodeAt(0) * 7919 + Number(cls.slice(1)) * 104729)
    const a = r(), b = r(), s = r() % 13
    const hid = makeComposed(cls, seed), y = hid.train(N)
    const d = discoverCompose(y, { maxDepth: 3, ms: 8000 })
    let verdict = "FALLO"
    if (d) { const v = evalVec(d.node, FAR); let ok = true; for (let n = 0; n < FAR && ok; n++) if (v[n] !== (n < N ? y[n]! : hid.eval(n))) ok = false; verdict = ok ? "EXACTO" : "no generaliza" }
    console.log(`#${k} s=${s} tz(a)=${tz(a)} tz(a)-s=${tz(a) - s} ${verdict.padEnd(13)} costo=${d ? d.cost : "-"} ruta=${d ? d.path.join(">") : "-"} ${d ? show(d.node).slice(0, 90) : ""}`)
  }
}
