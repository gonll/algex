// Diagnóstico de desarrollo (semillas 4001+): ¿qué árboles salen en los carriles? ¿por qué falla la compartición?
//   CLS=A1 M=4 SEED=4001 npx tsx scripts/lab-17b-diagnose.ts
import { makeComposed, ClassId } from "../src/lab/hidden-compose"
import { discoverCompose, show } from "../src/lab/compose"
import { simplify, costBits, Node } from "../src/lab/ast"
import { lane, laneLen, walk } from "../src/lab/decimate"

const CLS = (process.env.CLS ?? "A1") as ClassId, M = Number(process.env.M ?? 4), SEED = Number(process.env.SEED ?? 4001), DEPTH = Number(process.env.DEPTH ?? 2)
const N = 1 << 16, y = makeComposed(CLS, SEED).train(N), L = laneLen(N, M)
const sig = (n: Node) => JSON.stringify(walk(n, () => 0))
for (let c = 0; c < Math.min(M, 8); c++) {
  const r = discoverCompose(lane(y, M, c, L), { maxDepth: DEPTH })
  if (!r) { console.log(`c=${c}: sin solución`); continue }
  const n = simplify(r.node)
  console.log(`c=${c}: ${costBits(n)} bits  ${show(n)}  ruta=${r.path.join(">")}  firma=${sig(n).slice(0, 90)}`)
}
