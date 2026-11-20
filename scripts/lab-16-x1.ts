import { makeHidden } from "../src/lab/hidden-gen"
import { discoverCompose, stageWork, DEFAULT_WORK } from "../src/lab/compose"
const N = 1 << 16
for (let s = 1; s <= 10; s++) {
  const y = makeHidden("X1", s).train(N)
  const r = discoverCompose(y, { maxDepth: 3 })
  console.log(`X1#${s} ${r ? `cost=${r.cost} work=${(r.work / 1e6).toFixed(0)}M ms=${r.ms.toFixed(0)} stages=${r.stageCosts.map((c) => (c === Infinity ? "∞" : c)).join(",")} ${r.path.join(">").slice(0, 40)}` : "null"}`)
}
console.log("presupuesto por etapa:", [0, 1, 2, 3].map((d) => (stageWork(DEFAULT_WORK, d) / 1e6).toFixed(0) + "M").join(" "))
