// Regresión del motor con presupuesto determinista (semillas de DESARROLLO: no es un lote ciego).
import * as zlib from "zlib"
import { makeComposed, makeGrid, ClassId, GridKind } from "../src/lab/hidden-compose"
import { makeHidden, FamilyId, Hidden } from "../src/lab/hidden-gen"
import { discoverCompose } from "../src/lab/compose"
import { evalVec } from "../src/lab/ast"

const N = 1 << 16, FAR = 1 << 20
const brotli = (y: Uint8Array) => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1]! : NaN)
const run = (label: string, mk: (s: number) => Hidden, seeds: number[], depth: number, work?: number) => {
  let desc = 0, acc = 0; const ms: number[] = [], wk: number[] = [], costs: number[] = []
  for (const sd of seeds) {
    const hid = mk(sd), y = hid.train(N), thr = 0.25 * Math.min(brotli(y), 8 * N)
    const r = discoverCompose(y, { maxDepth: depth, work })
    if (!r) continue
    ms.push(r.ms); wk.push(r.work / 1e6)
    const v = evalVec(r.node, FAR); let exact = true
    for (let n = N; n < FAR && exact; n++) if (v[n] !== hid.eval(n)) exact = false
    if (r.cost < thr) { acc++; costs.push(r.cost); if (exact) desc++ }
  }
  console.log(`${label.padEnd(14)} depth=${depth} | desc ${String(desc).padStart(2)}/${seeds.length} acept ${String(acc).padStart(2)} | costo med ${costs.length ? med(costs).toFixed(0) : "—"} | ms med ${med(ms).toFixed(0).padStart(6)} máx ${ms.length ? Math.max(...ms).toFixed(0) : "-"} | trabajo med ${med(wk).toFixed(0)}M`)
}
const seeds10 = Array.from({ length: 10 }, (_, i) => i + 1)
const mode = process.argv[2] ?? "reg"
if (mode === "reg") {
  for (const c of ["A1", "A2", "A3", "A4", "A5"]) run(c, (s) => makeComposed(c as ClassId, s), seeds10, 3)
  for (const c of ["X1", "X2"]) run(c, (s) => makeHidden(c as FamilyId, s), seeds10, 3)
} else {
  const seeds5 = [2001, 2002, 2003, 2004, 2005]
  for (const j of [4, 5, 6]) for (const d of [3, 4, 5]) run(`G11 j=${j}`, (s) => makeGrid("G11" as GridKind, j, s), seeds5, d)
}
