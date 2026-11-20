// Curva éxito-presupuesto: ¿cuánto trabajo necesitan las instancias que fallan por presupuesto?
import { makeHidden } from "../src/lab/hidden-gen"
import { discoverCompose } from "../src/lab/compose"
const N = 1 << 16
for (const s of [2, 8]) for (const W of [7e8, 1.5e9, 3e9, 6e9]) {
  const y = makeHidden("X1", s).train(N)
  const r = discoverCompose(y, { maxDepth: 3, work: W })
  console.log(`X1#${s} W=${(W / 1e6).toFixed(0)}M  ${r ? `cost=${r.cost} work=${(r.work / 1e6).toFixed(0)}M ms=${r.ms.toFixed(0)} ${r.path[0]}` : "null"}`)
}
