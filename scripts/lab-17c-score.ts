// Puntúa el lote ciego de diezmado contra las predicciones de la adenda 2 de prereg-diezmado.md (solo lee los crudos).
//   npx tsx scripts/lab-17c-score.ts
import { readFileSync } from "fs"
const parse = (f: string) => {
  const out: Record<string, number> = {}
  for (const l of readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^(G1[12]):(\d+)\s+(\d+)\s+\d+ \|\s*(\d+)\/10 \|\s*(\d+)\/10/)
    if (m) out[`${m[2]}|${m[3]}`] = Number(m[5])
  }
  return out
}
const v2 = (m: number) => { let t = 0; while (m % 2 === 0) { m /= 2; t++ } return t }
for (const kind of ["g11", "g12"]) {
  const d = parse(`docs/research/lab-17-blind-${kind}-raw.txt`)
  let solved = 0, solvedViol = 0, unsolved = 0, unsolvedViol = 0, bound = 0
  const viol: string[] = []
  for (const [k, ex] of Object.entries(d)) {
    const [j, m] = k.split("|").map(Number) as [number, number], v = v2(m)
    if (v >= 2 || j <= v + 2) { solved++; if (ex <= 7) { solvedViol++; viol.push(`j=${j} m=${m}: ${ex}/10 (esperado ≥8)`) } }
    else if (v <= 1 && j >= v + 4) { unsolved++; if (ex >= 2) { unsolvedViol++; viol.push(`j=${j} m=${m}: ${ex}/10 (esperado ≤1)`) } }
    else bound++
  }
  console.log(`${kind.toUpperCase()}: celdas interiores resueltas ${solved} (violaciones ${solvedViol}) | no resueltas ${unsolved} (violaciones ${unsolvedViol}) | frontera ${bound}`)
  for (const s of viol) console.log("   ", s)
}
