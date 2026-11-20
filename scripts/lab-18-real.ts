// Experimento 13 — datos reales: Algex actual vs brotli vs sintetizador experimental (costo completo), con controles.
//   npx tsx scripts/lab-18-real.ts            (protocolo y reglas: docs/research/prereg-real.md)
// Éxito de una columna: S < min(B0,B1,B2,B3,A) − 8 bits Y el modelo reproduce TODA la columna. Una fórmula sin ahorro NO es éxito.
import { readFileSync, openSync, readSync, closeSync } from "fs"
import { createHash } from "crypto"
import { compress } from "../src/index"
import { Column, MIN_N, makeColumn, planes, columnBytes, shuffled, pcapColumns, pcapPacketCount, csvColumns, jsonColumns } from "../src/lab/columns"
import { gammaBits } from "../src/lab/decimate"
import { fitPlane, baselines, columnSynthCost, predictorResidual, diagnose, brotli, PlaneFit } from "../src/lab/realfit"

const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8)
console.log(`Exp. 13 datos reales. hashes compose=${hash("src/lab/compose.ts")} decimate=${hash("src/lab/decimate.ts")} realfit=${hash("src/lab/realfit.ts")} columns=${hash("src/lab/columns.ts")} encoder=${hash("src/codec/encoder.ts")}\n`)
const ONLY = process.env.ONLY?.split(",")
const MARGIN = 8

interface Unit { dataset: string; col: Column }
interface Acc { cols: number; short: number; discarded: number; fileBytes: number; colBytes: number }
const acc: Record<string, Acc> = {}, units: Unit[] = []
const bump = (ds: string, k: keyof Acc, v: number) => { (acc[ds] ??= { cols: 0, short: 0, discarded: 0, fileBytes: 0, colBytes: 0 })[k] += v }
const addCols = (ds: string, cols: Column[]) => { for (const c of cols) { bump(ds, "cols", 1); if (c.n < MIN_N) bump(ds, "short", 1); else units.push({ dataset: ds, col: c }) } }
const rd = (p: string) => { const b = readFileSync(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength) }
const want = (ds: string) => !ONLY || ONLY.includes(ds)

// ── carga ──────────────────────────────────────────────────────────────────────────────────────
const PCAPS: [string, string][] = [
  ["P1 smallFlows", "test/real-data/pcap/smallFlows.pcap"], ["P2 bigFlows(24MB)", "test/real-data/pcap/bigFlows_prefix24MB.pcap"],
  ["P3 http.cap", "test/real-data/pcap/http.cap"], ["P4 dhcpv6_1", "test/real-data/pcap/dhcpv6_1.pcap"],
  ["P5 sip-rtp-opus", "test/real-data/pcap/sip-rtp-opus-hybrid.pcap"], ["P6 STP(pcapng)", "test/real-data/pcap/STP_UplinkFast.pcapng"],
]
for (const [ds, path] of PCAPS) {
  if (!want(ds)) continue
  const buf = rd(path); bump(ds, "fileBytes", buf.length)
  const cols = pcapColumns(ds, buf)
  if (!cols) { console.log(`# ${ds}: no es pcap clásico Ethernet (${buf.length} B): sin columnas extraídas (demasiado corto: < ${MIN_N} paquetes)`); bump(ds, "short", 1); bump(ds, "cols", 1); continue }
  console.log(`# ${ds}: ${pcapPacketCount(buf)} paquetes, ${cols.length} columnas`)
  addCols(ds, cols)
}
const readHead = (path: string, bytes: number): string => { const fd = openSync(path, "r"), b = Buffer.alloc(bytes); const n = readSync(fd, b, 0, bytes, 0); closeSync(fd); const s = b.subarray(0, n).toString("utf8"); return s.slice(0, s.lastIndexOf("\n")) }
if (want("N1 USGS")) {
  const text = readFileSync("test/real-data/numeric/usgs_all_month.csv", "utf8"), r = csvColumns("N1 USGS", text, ",")
  bump("N1 USGS", "fileBytes", text.length); bump("N1 USGS", "discarded", r.discarded.length)
  console.log(`# N1 USGS: ${r.columns.length} columnas numéricas; descartadas ${r.discarded.length}: ${r.discarded.map((d) => `${d.name}(${d.reason})`).join(", ")}`)
  addCols("N1 USGS", r.columns)
}
if (want("N2 UCI")) {
  const text = readHead("test/real-data/numeric/uci/household_power_consumption.txt", 9_000_000), r = csvColumns("N2 UCI", text, ";", 65536)
  bump("N2 UCI", "fileBytes", text.length); bump("N2 UCI", "discarded", r.discarded.length)
  console.log(`# N2 UCI: ${r.columns.length} columnas numéricas; descartadas ${r.discarded.length}: ${r.discarded.map((d) => `${d.name}(${d.reason})`).join(", ")}`)
  addCols("N2 UCI", r.columns)
}
if (want("N2b UCI-post-hoc")) {   // VARIANTE POST HOC (declarada tras ver N2): el marcador de dato faltante "?" se trata como celda vacía
  const text = readHead("test/real-data/numeric/uci/household_power_consumption.txt", 9_000_000), r = csvColumns("N2b UCI-post-hoc", text, ";", 65536, "?")
  bump("N2b UCI-post-hoc", "fileBytes", text.length); bump("N2b UCI-post-hoc", "discarded", r.discarded.length)
  console.log(`# N2b UCI (post hoc, ? = vacío): ${r.columns.length} columnas numéricas; descartadas ${r.discarded.length}: ${r.discarded.map((d) => `${d.name}(${d.reason})`).join(", ")}`)
  addCols("N2b UCI-post-hoc", r.columns)
}
if (want("N3 tr46")) {
  const raw = readFileSync("node_modules/tr46/lib/mappingTable.json", "utf8"); bump("N3 tr46", "fileBytes", raw.length)
  addCols("N3 tr46", jsonColumns("N3 tr46", JSON.parse(raw) as unknown[]))
}
// Sintéticas de validación del arnés (NO son datos reales)
if (want("S sintéticas")) {
  const n = 8192; let s = 99
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 16) & 255 }
  const S1 = Array.from({ length: n }, (_, i) => BigInt((3 + 5 * i + 11 * i * i) & 0xffff))
  const S2 = Array.from({ length: n }, (_, i) => BigInt(Math.round(1000 + 2.5 * i + 0.0004 * i * i) + (rnd() % 5) - 2))   // suave, sin desbordamiento, ruido ±2
  const S3 = Array.from({ length: n }, () => BigInt(rnd()))
  addCols("S sintéticas", [makeColumn("S", "S1 poly exacto", S1)!, makeColumn("S", "S2 curva suave+ruido±2", S2)!, makeColumn("S", "S3 aleatorio", S3)!])
}
console.log(`\n${units.length} columnas a evaluar (n ≥ ${MIN_N}).\n`)

// ── evaluación ─────────────────────────────────────────────────────────────────────────────────
interface Res { errA: string; u: Unit; shuffledCtl: boolean; bl: { b0: number; b1: number; b2: number; b3: number }; A: number; msA: number; msB: number; S: number; fits: PlaneFit[]; ms: number; work: number; base: number; success: boolean; formulaNoSaving: boolean; overfit: number; pr: ReturnType<typeof predictorResidual>; diag: ReturnType<typeof diagnose> }
const evalCol = (u: Unit, shuf: boolean): Res => {
  const c = u.col, pl = planes(c), bytes = columnBytes(c)
  let t = Date.now(); const bl = baselines(c); const msB = Date.now() - t
  let A = Infinity, msA = 0, errA = ""
  if (!shuf) { t = Date.now(); try { A = 8 * compress(bytes, "max").length } catch (e) { errA = String((e as Error).message) } msA = Date.now() - t }   // un fallo de Algex se registra y la columna se evalúa sin A
  const fits = pl.map((p) => fitPlane(p)), S = columnSynthCost(c, fits, pl)
  const META = 64 + gammaBits(c.n) + gammaBits(c.w)   // los baselines también necesitan mínimo, n y w para reconstruir la columna
  const base = Math.min(bl.b0, bl.b1, bl.b2, bl.b3, A) + META
  const anyModel = fits.some((f) => f.accepted && f.exactFull), overfit = fits.filter((f) => f.accepted && !f.exactFull).length
  const success = S < base - MARGIN && anyModel
  return { errA, u, shuffledCtl: shuf, bl, A, msA, msB, S, fits, ms: fits.reduce((s, f) => s + f.ms, 0), work: fits.reduce((s, f) => s + f.work, 0), base, success, formulaNoSaving: anyModel && !success, overfit, pr: success ? null : predictorResidual(c), diag: diagnose(c) }
}
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : "—")
const results: Res[] = [], ctl: Res[] = []
console.log("dataset / columna".padEnd(34), "n".padStart(6), "w", "|", "B0".padStart(8), "B1".padStart(8), "B2".padStart(8), "B3".padStart(8), "Algex".padStart(8), "| S(sint)".padStart(9), "| ahorro | planos (A=acept, X=exacto, m) | ms-sint ms-brotli ms-Algex | pred+resid | monot. Hδ")
for (const u of units) {
  const r = evalCol(u, false); results.push(r)
  const planeStr = r.fits.map((f) => (f.accepted ? `${f.exactFull ? "AX" : "A!"}m${f.m}:${f0(f.bits)}` : "·")).join(" ")
  const sav = r.success ? `${f0(r.base - r.S)}b (${(100 * (r.base - r.S) / r.base).toFixed(0)}%)` : r.formulaNoSaving ? "fórmula sin ahorro" : "0"
  console.log(`${u.dataset.slice(0, 2)} ${u.col.name}`.padEnd(34), String(u.col.n).padStart(6), u.col.w, "|", f0(r.bl.b0).padStart(8), f0(r.bl.b1).padStart(8), f0(r.bl.b2).padStart(8), f0(r.bl.b3).padStart(8), (r.errA ? "ERROR" : f0(r.A)).padStart(8), "|", f0(r.S).padStart(8), "|", sav.padEnd(12), "|", planeStr.padEnd(34), "|", `${r.ms} ${r.msB} ${r.msA} w=${(r.work/1e9).toFixed(1)}G`.padEnd(26), "|", r.pr ? `${f0(r.pr.bits)} ${r.pr.kind}` : "—", "|", `${r.diag.monotone.toFixed(2)} ${r.diag.deltaEntropy.toFixed(1)}`)
}
if (!process.env.SKIP_SHUF) {
  console.log("\n— controles: filas barajadas (misma distribución, sin orden) —")
  for (const u of units) {
    if (u.dataset === "S sintéticas" && !u.col.name.startsWith("S1") && !u.col.name.startsWith("S2")) continue
    const r = evalCol({ dataset: u.dataset, col: shuffled(u.col, 4242) }, true); ctl.push(r)
    if (r.success || r.formulaNoSaving || r.overfit) console.log(`  ${u.dataset.slice(0, 2)} ${u.col.name}: ${r.success ? "ÉXITO (falso positivo)" : r.formulaNoSaving ? "fórmula sin ahorro" : ""}${r.overfit ? ` aceptado-no-exacto×${r.overfit}` : ""}`)
  }
}

// ── resumen ────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== RESUMEN por conjunto (columnas reales; S sintéticas aparte) ===")
const byDs: Record<string, Res[]> = {}; for (const r of results) (byDs[r.u.dataset] ??= []).push(r)
let totBase = 0, totBest = 0, totBytes = 0, totSuccessBytes = 0
for (const [ds, rs] of Object.entries(byDs)) {
  const a = acc[ds]!, ok = rs.filter((r) => r.success), bytes = rs.reduce((s, r) => s + r.u.col.n * r.u.col.w, 0)
  const baseSum = rs.reduce((s, r) => s + r.base, 0), bestSum = rs.reduce((s, r) => s + Math.min(r.base, r.S), 0)
  const succBytes = ok.reduce((s, r) => s + r.u.col.n * r.u.col.w, 0)
  console.log(`${ds.padEnd(18)} columnas ${a.cols} (cortas ${a.short}, descartadas-CSV ${a.discarded}) evaluadas ${rs.length} | éxitos ${ok.length} | fórmula sin ahorro ${rs.filter((r) => r.formulaNoSaving).length} | sobreajuste (aceptado-no-exacto) ${rs.reduce((s, r) => s + r.overfit, 0)} planos | ahorro neto ${f0(baseSum - bestSum)} bits de ${f0(baseSum)} (${(100 * (baseSum - bestSum) / baseSum).toFixed(2)}%) | cobertura (bytes con éxito / bytes de columnas) ${(100 * succBytes / bytes).toFixed(1)}%${a.fileBytes ? ` | / bytes de archivo ${(100 * succBytes / a.fileBytes).toFixed(2)}%` : ""}`)
  if (ds !== "S sintéticas") { totBase += baseSum; totBest += bestSum; totBytes += bytes; totSuccessBytes += succBytes }
}
console.log(`TOTAL reales: ahorro neto ${f0(totBase - totBest)} bits de ${f0(totBase)} (${(100 * (totBase - totBest) / totBase).toFixed(3)}%); bytes con éxito ${totSuccessBytes} de ${totBytes}`)
const real = results.filter((r) => r.u.dataset !== "S sintéticas"), ctlReal = ctl.filter((r) => r.u.dataset !== "S sintéticas")
console.log(`\nColumnas reales: éxitos ${real.filter((r) => r.success).length}/${real.length}; fórmula sin ahorro ${real.filter((r) => r.formulaNoSaving).length}; con algún plano aceptado-no-exacto ${real.filter((r) => r.overfit).length}`)
console.log(`Controles barajados (reales): éxitos (falsos positivos) ${ctlReal.filter((r) => r.success).length}/${ctlReal.length}; fórmula sin ahorro ${ctlReal.filter((r) => r.formulaNoSaving).length}; aceptados-no-exactos ${ctlReal.filter((r) => r.overfit).length}`)
const tot = (rs: Res[], k: "ms" | "msB" | "msA") => rs.reduce((s, r) => s + r[k], 0)
console.log(`Trabajo determinista del sintetizador (reales): ${(real.reduce((a, r) => a + r.work, 0) / 1e9).toFixed(1)} G unidades`)
console.log(`Tiempo total: sintetizador ${tot(real, "ms")} ms | brotli(4 baselines) ${tot(real, "msB")} ms | Algex ${tot(real, "msA")} ms | razón sint/brotli ${(tot(real, "ms") / Math.max(1, tot(real, "msB"))).toFixed(0)}×`)
const nonWin = real.filter((r) => !r.success && r.pr)
const better = nonWin.filter((r) => r.pr!.bits < r.base - MARGIN), vsDelta = nonWin.map((r) => r.pr!.bits / Math.min(r.bl.b2, r.bl.b3)).sort((a, b) => a - b)
console.log(`Predictor+residual (análisis) en ${nonWin.length} columnas sin éxito del sintetizador: gana al baseline en ${better.length}; razón mediana vs min(B2,B3) = ${(vsDelta[vsDelta.length >> 1] ?? NaN).toFixed(3)}`)
for (const r of better) console.log(`   ${r.u.dataset.slice(0, 2)} ${r.u.col.name}: pred+resid ${f0(r.pr!.bits)} (${r.pr!.kind}) vs baseline ${f0(r.base)} (−${f0(r.base - r.pr!.bits)} bits, ${(100 * (r.base - r.pr!.bits) / r.base).toFixed(1)}%)`)
void brotli
