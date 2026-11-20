// Experimento 11 — lote C ciego: resultados separados dentro / fuera de las clases diseñadas.
//   npx tsx scripts/lab-14-blind-c.ts <main|grid|depth> <instancias/clase> <ms> [maxDepth]
// Por instancia: ACEPTADA (costo < 25 % de min(brotli, crudo)), DESCUBIERTA (aceptada y exacta en todo [N, 2^20)),
// EXACTA-NO-ACEPTADA (exacta en [N, 2^20) pero costo >= umbral).
import * as zlib from "zlib"
import { createHash } from "crypto"
import { readFileSync } from "fs"
import { makeComposed, makeGrid, CLASSES, ClassId, GridKind } from "../src/lab/hidden-compose"
import { makeHidden, FamilyId, Hidden } from "../src/lab/hidden-gen"
import { discoverCompose } from "../src/lab/compose"
import { evalVec } from "../src/lab/ast"

const mode = process.argv[2] ?? "main", PER = Number(process.argv[3] ?? 10), MS = Number(process.argv[4] ?? 8000), DEPTH = Number(process.argv[5] ?? 3)
const N = 1 << 16, FAR = 1 << 20, SEED = Number(process.env.SEED ?? 2000)
const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8)
console.log(`Lote C (${mode}) ${PER}/clase N=${N} ${MS} ms maxDepth=${DEPTH}. hashes compose=${hash("src/lab/compose.ts")} ast=${hash("src/lab/ast.ts")} probes=${hash("src/lab/probes.ts")} hidden-compose=${hash("src/lab/hidden-compose.ts")}\n`)
const brotli = (y: Uint8Array) => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1]! : NaN)

interface Spec { id: string; group: string; make: (seed: number) => Hidden }
const named = (id: string, group: string): Spec => ({
  id, group,
  make: (seed) => (["X1", "X2", "H", "R", "T"].includes(id) ? makeHidden(id as FamilyId, seed) : makeComposed(id as ClassId, seed)),
})
const specs: Spec[] = []
if (mode === "main") {
  for (const id of ["B1", "B2", "B3", "B4", "B8", "B14", "X1", "X2"]) specs.push(named(id, "1 diseñada (tipo ya visto)"))
  for (const id of ["D1", "D3"]) specs.push(named(id, "2 diseñada (composición nueva)"))
  for (const id of ["B5", "B9", "B10", "C1", "C2"]) specs.push(named(id, "3 fuera de diseño"))
  for (const id of ["H", "R", "T"]) specs.push(named(id, "4 control"))
} else {
  const js = process.env.GRID_J ? process.env.GRID_J.split(",").map(Number) : mode === "grid" ? [0, 1, 2, 3, 4, 5, 6, 8] : [4, 5, 6, 7]
  for (const kind of (process.env.GRID_KINDS?.split(",") ?? (mode === "grid" ? ["G11", "G12"] : ["G11"])) as GridKind[]) for (const j of js) specs.push({ id: `${kind} j=${j}`, group: "rejilla 2-ádica", make: (seed) => makeGrid(kind, j, seed) })
}

const byGroup: Record<string, { desc: number; acc: number; exactNoAcc: number; n: number }> = {}
console.log("clase".padEnd(10), "| desc | acept | exacta-no-acept | costo mediano (aceptadas) vs brotli | ms med | rutas")
for (const sp of specs) {
  let desc = 0, acc = 0, exNo = 0; const costs: number[] = [], brs: number[] = [], ms: number[] = [], routes: Record<string, number> = {}
  for (let k = 1; k <= PER; k++) {
    const hid = sp.make(SEED + k), y = hid.train(N), bro = brotli(y), thr = 0.25 * Math.min(bro, 8 * N)
    const r = discoverCompose(y, { maxDepth: DEPTH, ms: MS, greedy: process.argv[6] === "greedy=0.1" ? 0.1 : undefined, il2Gate: process.env.IL2_GATE === "legacy" ? "legacy" : undefined })
    if (!r) continue
    ms.push(r.ms)
    const v = evalVec(r.node, FAR); let exact = true
    for (let n = N; n < FAR && exact; n++) if (v[n] !== hid.eval(n)) exact = false
    const accepted = r.cost < thr
    if (accepted) { acc++; costs.push(r.cost); brs.push(bro); const key = r.path.join(">").slice(0, 36); routes[key] = (routes[key] ?? 0) + 1 }
    if (accepted && exact) desc++; else if (!accepted && exact) exNo++
  }
  const g = (byGroup[sp.group] ??= { desc: 0, acc: 0, exactNoAcc: 0, n: 0 }); g.desc += desc; g.acc += acc; g.exactNoAcc += exNo; g.n += PER
  const rt = Object.entries(routes).map(([k, v]) => `${k}×${v}`).join(" ")
  console.log(sp.id.padEnd(10), "|", `${desc}/${PER}`.padStart(4), "|", `${acc}/${PER}`.padStart(5), "|", `${exNo}`.padStart(15), "|", (costs.length ? `${med(costs).toFixed(0)} vs ${med(brs).toFixed(0)}` : "—").padStart(34), "|", med(ms).toFixed(0).padStart(6), "|", rt)
}
console.log("\nPor grupo (descubiertas / aceptadas / exactas-no-aceptadas / total):")
for (const [g, v] of Object.entries(byGroup).sort()) console.log(`  ${g.padEnd(32)} ${v.desc} / ${v.acc} / ${v.exactNoAcc} / ${v.n}`)
void CLASSES
