// Experimento 10 — Etapa 1: auditoría. ¿Qué propiedades observables sobreviven a una capa externa?
//   npx tsx scripts/lab-10-audit.ts
import { makeHidden, FamilyId, FAMILIES } from "../src/lab/hidden-gen"
import { discover } from "../src/lab/synth"
import * as P from "../src/lab/probes"

const N = 1 << 16
const fams = ["A", "B", "C", "D", "E", "G", "X1", "X2", "H", "R"] as FamilyId[]
console.log("N=65536, 8 instancias/familia. Cada celda = fracción de instancias donde la sonda se cumple (o mediana).\n")
console.log("fam | solver congelado resuelve | período 2^m (mediana) | Δ^k=0 (k≤12) | incrementos≤2 | afín GF(2) | ANF ≤400 mon. | dim simetrías XOR (mediana) | niveles de dependencia por plano (mediana)")
for (const f of fams) {
  const R = { solved: 0, per: [] as number[], poly: 0, inc: 0, gf2: 0, anf: 0, sym: [] as number[], lv: [] as number[][] }
  const M = 8
  for (let s = 1; s <= M; s++) {
    const y = makeHidden(f, s).train(N)
    if (discover(y).rep) R.solved++
    R.per.push(P.pow2Period(y)); if (P.polyDegree(y) >= 0) R.poly++
    if (P.incrementAlphabet(y) <= 2) R.inc++
    if (P.isGf2Affine(y)) R.gf2++
    const w = P.anfWeight(y); if (w >= 0 && w <= 400) R.anf++
    R.sym.push(P.xorSymmetry(y).dim); R.lv.push(P.planeDependenceLevels(y))
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!
  const lvm = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => med(R.lv.map((l) => l[j]!))).join("")
  console.log(`${f.padEnd(3)} | ${R.solved}/${M} | ${med(R.per)} | ${R.poly}/${M} | ${R.inc}/${M} | ${R.gf2}/${M} | ${R.anf}/${M} | ${med(R.sym)} | ${lvm}   (${FAMILIES[f]})`)
}
