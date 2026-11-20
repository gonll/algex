import { makeComposed } from "../src/lab/hidden-compose"
import { discoverCompose, prof } from "../src/lab/compose"
const y = makeComposed("B1", 4001).train(1 << 16)
const t = performance.now()
const r = discoverCompose(y, { maxDepth: 3, work: 1e12, ms: 30000 })
console.log("total ms", (performance.now() - t).toFixed(0), "work", r ? (r.work / 1e6).toFixed(0) + "M" : "-", "stageCosts", r?.stageCosts.join(","))
for (const [k, v] of Object.entries(prof).sort((a, b) => b[1] - a[1])) console.log(k.padEnd(18), v.toFixed(0).padStart(8), "ms")
