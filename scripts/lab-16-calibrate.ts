// Calibración del presupuesto determinista: unidades de trabajo consumidas vs milisegundos, por etapa y clase.
import { makeComposed, makeGrid } from "../src/lab/hidden-compose"
import { makeHidden } from "../src/lab/hidden-gen"
import { discoverCompose } from "../src/lab/compose"

const N = 1 << 16
const cases: Array<[string, (s: number) => ReturnType<typeof makeHidden>]> = [
  ["B1", (s) => makeComposed("B1", s)], ["X1", (s) => makeHidden("X1", s)], ["X2", (s) => makeHidden("X2", s)],
  ["B4", (s) => makeComposed("B4", s)], ["D3", (s) => makeComposed("D3", s)],
  ["G11j3", (s) => makeGrid("G11", 3, s)], ["G12j4", (s) => makeGrid("G12", 4, s)], ["B9", (s) => makeComposed("B9", s)], ["R", (s) => makeHidden("R", s)],
]
console.log("clase | ms | work total | costo por etapa (0..3) | ruta")
for (const [name, mk] of cases) {
  for (let k = 1; k <= 3; k++) {
    const y = mk(4000 + k).train(N)
    const r = discoverCompose(y, { maxDepth: 3, work: 1e12, ms: 90000 })
    console.log(`${name.padEnd(6)}| ${r ? r.ms.toFixed(0).padStart(6) : "  -   "} | ${r ? (r.work / 1e6).toFixed(1).padStart(8) + "M" : "-"} | ${r ? r.stageCosts.map((c) => (c === Infinity ? "∞" : c)).join(",") : "-"} | ${r ? r.path.join(">").slice(0, 50) : "-"}${r?.timedOut ? " [TIMEOUT]" : ""}`)
  }
}
