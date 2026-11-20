// Experimento 09 — descubrimiento CIEGO: ¿puede el sintetizador reconstruir representaciones equivalentes de
// secuencias generadas por expresiones ocultas con parámetros aleatorios, sin saber cómo se generaron?
//
//   npx tsx scripts/lab-09-blind-discovery.ts <lote A|B> <instancias por familia> <instancias del catálogo por familia>
//
// Niveles de éxito (por instancia):
//   DESCUBIERTO  reproduce el entrenamiento Y acierta la continuación contigua Y acierta índices lejanos
//   SOBREAJUSTE  reproduce el entrenamiento pero NO generaliza (comprime, pero no descubrió la fórmula)
//   FALLO        no halla representación aceptada
// Lote A = desarrollo (se depura con él). Lote B = semillas distintas, se ejecuta UNA vez con el código congelado.
import * as zlib from "zlib"
import { makeHidden, FAMILIES, FamilyId, Hidden } from "../src/lab/hidden-gen"
import { discover, Rep } from "../src/lab/synth"
import { searchExpr, evalExpr } from "../src/lab/expr-search"

const batch = (process.argv[2] ?? "A").toUpperCase()
const PER = Number(process.argv[3] ?? 10)
const PER_CATALOG = Number(process.argv[4] ?? 0)
const N = 1 << Number(process.argv[5] ?? 16), FAR_MAX = 1 << 20
const seedBase = batch === "A" ? 0 : 1000

type Outcome = "DESCUBIERTO" | "SOBREAJUSTE" | "FALLO"
interface Verdict { out: Outcome; firstBad: number; badCount: number }
// Protocolo endurecido (revisión tras el lote A): la generalización se comprueba en TODOS los índices de [N, 2^20),
// no en una muestra; una discrepancia rara (p. ej. dos pendientes 'a' consistentes con el entrenamiento) ya cuenta.
const classify = (hid: Hidden, y: Uint8Array, ev: ((n: number) => number) | null): Verdict => {
  if (!ev) return { out: "FALLO", firstBad: -1, badCount: 0 }
  for (let n = 0; n < N; n++) if (ev(n) !== y[n]) return { out: "FALLO", firstBad: n, badCount: 1 }
  let first = -1, bad = 0
  for (let n = N; n < FAR_MAX; n++) if (ev(n) !== hid.eval(n)) { if (first < 0) first = n; bad++ }
  return { out: bad === 0 ? "DESCUBIERTO" : "SOBREAJUSTE", firstBad: first, badCount: bad }
}
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]! }

console.log(`Lote ${batch}: ${PER} instancias/familia (guiado), ${PER_CATALOG}/familia (catálogo). N=${N}; generalización comprobada en TODOS los índices de [N, 2^20)\n`)
console.log("fam | descripción                                       | GUIADO desc/sobreaj/fallo | costo mediano (bits) vs brotli | ms/inst | CATÁLOGO desc/sobreaj/fallo | transformación·solver ganadores")
const fpAll: string[] = [], overfitNotes: string[] = []
const fired: Record<string, [number, number]> = {}
for (const fam of Object.keys(FAMILIES) as FamilyId[]) {
  const tally = { DESCUBIERTO: 0, SOBREAJUSTE: 0, FALLO: 0 }, cat = { DESCUBIERTO: 0, SOBREAJUSTE: 0, FALLO: 0 }
  const costs: number[] = [], brs: number[] = [], ms: number[] = [], winners: Record<string, number> = {}
  for (let k = 1; k <= PER; k++) {
    const hid = makeHidden(fam, seedBase + k), y = hid.train(N)
    const d = discover(y)
    ms.push(d.millis)
    if (d.rep) d.rep.prepare?.(FAR_MAX + 1)
    const v = classify(hid, y, d.rep ? (n) => d.rep!.eval(n) : null), out = v.out
    tally[out]++
    if (out === "SOBREAJUSTE") overfitNotes.push(`${fam}#${k} ${d.transform}·${d.solver} primer desacuerdo n=${v.firstBad} (${v.badCount} de ${FAR_MAX - N}) | ${hid.describe.slice(0, 70)}`)
    if (d.rep) { costs.push(d.costBits); brs.push(8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length); const w = `${d.transform}·${d.solver}`; winners[w] = (winners[w] ?? 0) + 1 }
    const grp = ["A", "B", "C", "D", "E", "G", "F"].includes(fam) ? "diseñadas" : "controles"
    for (const t of d.trace) { const key = `${grp} ${t.split(":").slice(0, 2).join(":")}`; const e = (fired[key] ??= [0, 0]); e[0]++; if (t.includes(":F")) e[1]++ }
    if (d.rep && out !== "DESCUBIERTO" && !["A", "B", "C", "D", "E", "G", "F"].includes(fam)) fpAll.push(`${fam}#${k}:${out}`)
    if (k <= PER_CATALOG) {
      const r = searchExpr(y, "byte", { maxSize: 6, layerCap: 20000, budgetNodes: 200000 })
      cat[classify(hid, y, r ? (n) => evalExpr(r.expr, n) & 255 : null).out]++
    }
  }
  const win = Object.entries(winners).map(([k, v]) => `${k}×${v}`).join(" ")
  console.log(`${fam.padEnd(3)} | ${FAMILIES[fam].padEnd(49)} | ${`${tally.DESCUBIERTO}/${tally.SOBREAJUSTE}/${tally.FALLO}`.padStart(25)} | ${costs.length ? `${median(costs).toFixed(0)} vs ${median(brs).toFixed(0)}`.padStart(30) : "—".padStart(30)} | ${median(ms).toFixed(0).padStart(7)} | ${PER_CATALOG ? `${cat.DESCUBIERTO}/${cat.SOBREAJUSTE}/${cat.FALLO}`.padStart(27) : "(no ejecutado)".padStart(27)} | ${win}`)
}
console.log("\nSobreajustes (detalle):"); for (const l of overfitNotes) console.log("  " + l)
console.log("\nHallazgos aceptados que NO generalizan en familias de control (falsos positivos / sobreajuste):", fpAll.length ? fpAll.join(" ") : "ninguno")
console.log("\nDisparos de propiedad por grupo y transformación:solver (veces que la propiedad se cumplió / veces evaluada). En controles, un disparo es un falso disparo:")
for (const [k, [n, f]] of Object.entries(fired).sort()) console.log(`  ${k.padEnd(24)} ${f}/${n}`)
