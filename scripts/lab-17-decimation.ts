// Experimento 12 parte 2 — diezmado por módulo m como transformación general, con controles negativos.
//   SEED=4000 PER=3 DEPTH=2 MODULI=1,2,4,8,16 SPECS=G11:4,G11:5,A1 npx tsx scripts/lab-17-decimation.ts
// Los MISMOS datos de entrenamiento (N = 2^16 bytes) se parten en m carriles y_c(i) = y(m i + c) (longitud potencia de 2).
// Cada carril se resuelve con el solver CONGELADO (compose.ts, profundidad DEPTH). Por (clase, m):
//   aceptado : todos los carriles con costo < 25 % de min(brotli, crudo) del propio carril
//   exacto   : todos los carriles extrapolan sin error a [L, 2^20/m)         (generalización; usa el oculto SOLO para evaluar)
//   bits ind.: suma de costos de carril + cabecera;  bits comp.: con compartición de parámetros entre carriles (decimate.ts)
// Selección hidden-free: entre los m con todos los carriles aceptados se elige el de menos bits compartidos.
import * as zlib from "zlib"
import { createHash } from "crypto"
import { readFileSync } from "fs"
import { makeComposed, makeGrid, ClassId, GridKind } from "../src/lab/hidden-compose"
import { makeHidden, FamilyId, Hidden } from "../src/lab/hidden-gen"
import { discoverCompose } from "../src/lab/compose"
import { evalVec, simplify, Node } from "../src/lab/ast"
import { lane, laneLen, shareLanes } from "../src/lab/decimate"

const SEED = Number(process.env.SEED ?? 4000), PER = Number(process.env.PER ?? 3), DEPTH = Number(process.env.DEPTH ?? 2)
const MODULI = (process.env.MODULI ?? "1,2,3,4,5,6,8,16").split(",").map(Number)
const SPECS = (process.env.SPECS ?? "G11:4").split(",")
const J0 = process.env.J0 !== undefined ? Number(process.env.J0) : undefined   // J(d) calibrado, para la columna de predicción 2-ádica
const N = 1 << 16, FAR = 1 << 20
const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8)
console.log(`Diezmado SEED=${SEED} PER=${PER} DEPTH=${DEPTH} moduli=${MODULI} specs=${SPECS}. hashes compose=${hash("src/lab/compose.ts")} ast=${hash("src/lab/ast.ts")} decimate=${hash("src/lab/decimate.ts")} hidden-compose=${hash("src/lab/hidden-compose.ts")}\n`)
const brotli = (y: Uint8Array) => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1]! : NaN)
const v2 = (m: number) => { let t = 0; while (m % 2 === 0) { m /= 2; t++ } return t }

const make = (id: string, seed: number): { h: Hidden; j?: number } => {
  if (id.startsWith("G11:") || id.startsWith("G12:")) { const j = Number(id.slice(4)); return { h: makeGrid(id.slice(0, 3) as GridKind, j, seed), j } }
  if (["X1", "X2", "H", "R", "T", "A", "B", "C", "D", "E", "F", "G"].includes(id)) return { h: makeHidden(id as FamilyId, seed) }
  return { h: makeComposed(id as ClassId, seed) }
}

interface Row { ok: boolean; acc: boolean; exact: boolean; indBits: number; shBits: number; work: number; ms: number; stable: boolean; bro: number }
const solveModulus = (hid: Hidden, y: Uint8Array, m: number): Row => {
  const L = laneLen(N, m), nodes: Node[] = []
  let work = 0, ms = 0, acc = true, exact = true
  for (let c = 0; c < m; c++) {
    const ly = lane(y, m, c, L), t0 = Date.now()
    const r = discoverCompose(ly, { maxDepth: DEPTH })
    ms += Date.now() - t0
    if (!r) { acc = false; break }
    work += r.work
    if (!(r.cost < 0.25 * 8 * L)) { acc = false; break }     // corte de tiempo: un carril que ya cuesta >25 % del crudo no puede dar un total aceptable

    const node = simplify(r.node); nodes.push(node)
    if (exact) {
      const M = Math.floor((FAR - 1 - c) / m) + 1, v = evalVec(node, M)
      for (let i = L; i < M; i++) if (v[i] !== hid.eval(m * i + c)) { exact = false; break }
    }
  }
  if (!acc) return { ok: false, acc: false, exact: false, indBits: NaN, shBits: NaN, work, ms, stable: false, bro: NaN }
  const sh = shareLanes(nodes)
  for (let c = 0; c < m; c++) { const a = evalVec(sh.rebuild(c), L), b = lane(y, m, c, L); for (let i = 0; i < L; i++) if (a[i] !== b[i]) throw new Error(`rebuild no reversible m=${m} c=${c}`) }
  // REGLA DE ACEPTACIÓN (declarada antes de los lotes ciegos): la descripción que se almacena es la compartida completa,
  // así que se acepta si sus bits totales < 25 % de min(brotli, crudo) de los mismos m·L bytes.
  const bro = brotli(y.subarray(0, m * L)), accT = sh.bits < 0.25 * Math.min(bro, 8 * m * L)
  return { ok: true, acc: accT, exact, indBits: sh.independentBits, shBits: sh.bits, work, ms, stable: false, bro }
}

console.log("clase".padEnd(8), "m".padStart(3), "L".padStart(6), "| acept | exacto | bits ind. | bits comp. | brotli(m·L) | trabajo(G) | ms | pred.2ádica")
// Identificabilidad mínima, SIN oculto: cada carril se resuelve con su primera mitad; estable si el modelo así hallado reproduce el carril entero.
const stableHalf = (y: Uint8Array, m: number): boolean => {
  const L = laneLen(N, m)
  for (let c = 0; c < m; c++) {
    const ly = lane(y, m, c, L), r = discoverCompose(ly.subarray(0, L >> 1), { maxDepth: DEPTH })
    if (!r) return false
    const v = evalVec(simplify(r.node), L); for (let i = 0; i < L; i++) if (v[i] !== ly[i]) return false
  }
  return true
}
interface Pick { m: number; bits: number; exact: boolean; stable: boolean }
const summary: { id: string; whole: number; picks: Pick[]; none: number; n: number; wholeExact: number }[] = []
for (const id of SPECS) {
  const per: Record<number, Row[]> = {}, picks: Pick[] = []
  let none = 0, wholeExact = 0
  for (let k = 1; k <= PER; k++) {
    const { h } = make(id, SEED + k), y = h.train(N)
    let best: Pick | null = null
    for (const m of MODULI) {
      const row = solveModulus(h, y, m);        (per[m] ??= []).push(row)
      if (m === 1 && row.exact && row.acc) wholeExact++
      if (row.acc && (!best || row.shBits < best.bits)) best = { m, bits: row.shBits, exact: row.exact, stable: false }
    }
    if (best) { best.stable = stableHalf(y, best.m); picks.push(best) } else none++
  }
  const jj = make(id, SEED + 1).j
  for (const m of MODULI) {
    const rs = per[m]!, a = rs.filter((r) => r.acc).length, e = rs.filter((r) => r.acc && r.exact).length
    const L = laneLen(N, m)
    const pred = jj !== undefined && J0 !== undefined ? (jj - v2(m) <= J0 ? "sí" : "no") : "—"
    const okRows = rs.filter((r) => r.acc)
    console.log(id.padEnd(8), String(m).padStart(3), String(L).padStart(6), "|", `${a}/${PER}`.padStart(5), "|", `${e}/${PER}`.padStart(6), "|",
      (okRows.length ? med(okRows.map((r) => r.indBits)).toFixed(0) : "—").padStart(9), "|", (okRows.length ? med(okRows.map((r) => r.shBits)).toFixed(0) : "—").padStart(10), "|",
      (okRows.length ? med(okRows.map((r) => r.bro)).toFixed(0) : "—").padStart(11), "|", (med(rs.map((r) => r.work)) / 1e9).toFixed(1).padStart(10), "|", med(rs.map((r) => r.ms)).toFixed(0).padStart(6), "|", pred)
  }
  const bs = picks.length ? picks : []
  console.log(`  → selección hidden-free: elegidos ${bs.map((p) => `m=${p.m}${p.exact ? "✓" : "✗"}${p.stable ? "s" : "u"}`).join(" ") || "—"} | sin ninguna aceptada: ${none}`)
  summary.push({ id, whole: 0, picks, none, n: PER, wholeExact })
}
console.log("\nResumen (instancias con m elegido exacto / elegido no exacto / sin aceptación; y exactas con m=1):")
for (const s of summary) console.log(`  ${s.id.padEnd(8)} elegido exacto ${s.picks.filter((p) => p.exact).length} | elegido NO exacto ${s.picks.filter((p) => !p.exact).length} | estable(mitades)&exacto ${s.picks.filter((p) => p.stable && p.exact).length} | inestable&exacto ${s.picks.filter((p) => !p.stable && p.exact).length} | estable&NO-exacto ${s.picks.filter((p) => p.stable && !p.exact).length} | inestable&NO-exacto ${s.picks.filter((p) => !p.stable && !p.exact).length} | ninguna ${s.none} | m=1 exacta ${s.wholeExact}/${s.n}`)
