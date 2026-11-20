// Agrega los crudos de lab-18-real (exp. 13). Cuenta ahorro SOLO de columnas que cumplen la definición de éxito.
//   npx tsx scripts/lab-18c-aggregate.ts
import { readFileSync, existsSync, statSync } from "fs"
const FILES = ["p1", "p2", "n2", "rest"].map((k) => `docs/research/lab-18-real-${k}-raw.txt`)
const POST = "docs/research/lab-18-real-n2b-posthoc-raw.txt"
const ROW = /^(.{34}) +(\d+) (\d) \| +(\d+) +(\d+) +(\d+) +(\d+) +(\d+|ERROR) \| +(\d+) \| (.{12}) \| (.*?) \| (\S+ \S+ \S+ w=\S+) *\| (.*?) \| (\S+) (\S+)$/
interface Row { ds: string; name: string; n: number; w: number; b: number[]; A: number | null; S: number; ahorro: string; planes: string; ms: number; msBrotli: number; msA: number; work: number; success: boolean; formulaNoSaving: boolean; prRaw: string }
interface Ds { header: string; cols: number; short: number; rows: Row[]; discarded: number }
const parseFile = (f: string): Record<string, Ds> => {
  const out: Record<string, Ds> = {}
  if (!existsSync(f)) return out
  let inCtl = false
  const ensure = (k: string) => (out[k] ??= { header: "", cols: 0, short: 0, rows: [], discarded: 0 })
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (line.startsWith("— controles")) inCtl = true
    const h = line.match(/^# (P\d) (.*?): (\d+) paquetes, (\d+) columnas/)
    if (h) { const d = ensure(h[1]!); d.header = h[2]!; d.cols = Number(h[4]) }
    const ns = line.match(/^# (P\d) (.*?): no es pcap/); if (ns) { const d = ensure(ns[1]!); d.header = ns[2]!; d.cols = 1; d.short = 1 }
    const cs = line.match(/^# (N\d)b? .*?: (\d+) columnas numéricas; descartadas (\d+)/); if (cs) { const d = ensure(cs[1]!); d.cols = Number(cs[2]) + Number(cs[3]); d.discarded = Number(cs[3]) }
    if (inCtl) continue
    const m = line.match(ROW); if (!m) continue
    const [, nm, n, w, b0, b1, b2, b3, A, S, sav, planes, times, pr, mono] = m
    const t = times!.split(" "), key = nm!.slice(0, 2).trim() || "S"
    ensure(key).rows.push({ ds: key, name: nm!.slice(3).trim(), n: Number(n), w: Number(w), b: [b0, b1, b2, b3].map(Number) as number[], A: A === "ERROR" ? null : Number(A), S: Number(S), ahorro: sav!.trim(), planes: planes!.trim(), ms: Number(t[0]), msBrotli: Number(t[1]), msA: Number(t[2]), work: Number(t[3]!.slice(2, -1)) * 1e9, success: /^\d+b/.test(sav!.trim()), formulaNoSaving: sav!.includes("sin ahorro"), prRaw: pr!.trim() })
  }
  return out
}
const gam = (v: number) => 2 * Math.floor(Math.log2(v + 1)) + 1
const report = (title: string, ds: Record<string, Ds>, files: Record<string, number>) => {
  console.log(`\n##### ${title}`)
  let T = { cols: 0, short: 0, eval: 0, succ: 0, noSav: 0, overfit: 0, algexErr: 0, base: 0, saved: 0, bytes: 0, succBytes: 0, ms: 0, msB: 0, msA: 0 }
  for (const [k, d] of Object.entries(ds).sort()) {
    const real = k !== "S", rs = d.rows
    const base = rs.map((r) => Math.min(...r.b, r.A ?? Infinity) + 64 + gam(r.n) + gam(r.w))
    const succ = rs.filter((r) => r.success), bytes = rs.reduce((s, r) => s + r.n * r.w, 0), succBytes = succ.reduce((s, r) => s + r.n * r.w, 0)
    const saved = rs.reduce((s, r, i) => s + (r.success ? base[i]! - r.S : 0), 0), baseSum = base.reduce((a, b) => a + b, 0)
    const overfit = rs.reduce((s, r) => s + (r.planes.match(/A!/g)?.length ?? 0), 0)
    const cols = Math.max(d.cols, rs.length + d.discarded), shortCols = d.short || Math.max(0, cols - d.discarded - rs.length)
    console.log(`${k} ${d.header.padEnd(18)} columnas ${cols} | cortas (n<2048) ${shortCols} | descartadas por la regla (no numéricas/decimales) ${d.discarded} | evaluadas ${rs.length} | ÉXITOS ${succ.length} | fórmula sin ahorro ${rs.filter((r) => r.formulaNoSaving).length} | planos aceptados-no-exactos ${overfit} | Algex con excepción ${rs.filter((r) => r.A === null).length} | ahorro (solo éxitos) ${saved.toFixed(0)} de ${baseSum.toFixed(0)} bits (${baseSum ? (100 * saved / baseSum).toFixed(3) : "0"}%) | cobertura bytes columna ${bytes ? (100 * succBytes / bytes).toFixed(1) : "0"}%${files[k] ? ` | de bytes de archivo ${(100 * succBytes / files[k]!).toFixed(3)}%` : ""}`)
    for (const r of succ) console.log(`     éxito: ${r.name} (n=${r.n}, w=${r.w}) ahorro ${r.ahorro}  planos ${r.planes}`)
    if (real) { T.cols += cols; T.short += shortCols; T.eval += rs.length; T.succ += succ.length; T.noSav += rs.filter((r) => r.formulaNoSaving).length; T.overfit += overfit; T.algexErr += rs.filter((r) => r.A === null).length; T.base += baseSum; T.saved += saved; T.bytes += bytes; T.succBytes += succBytes; T.ms += rs.reduce((s, r) => s + r.ms, 0); T.msB += rs.reduce((s, r) => s + r.msBrotli, 0); T.msA += rs.reduce((s, r) => s + r.msA, 0) }
  }
  console.log(`TOTAL reales: columnas ${T.cols} | cortas ${T.short} | evaluadas ${T.eval} | ÉXITOS ${T.succ} | fórmula sin ahorro ${T.noSav} | planos aceptados-no-exactos ${T.overfit} | Algex con excepción ${T.algexErr} | ahorro (solo éxitos) ${T.saved.toFixed(0)} de ${T.base.toFixed(0)} bits (${(100 * T.saved / T.base).toFixed(3)}%) | bytes con éxito ${T.succBytes} de ${T.bytes} | tiempo sint ${(T.ms / 1000).toFixed(0)} s, brotli ${(T.msB / 1000).toFixed(1)} s, Algex ${(T.msA / 1000).toFixed(0)} s`)
}
const merged: Record<string, Ds> = {}
for (const f of FILES) for (const [k, d] of Object.entries(parseFile(f))) merged[k] = d
const sizes: Record<string, number> = { P1: statSync("test/real-data/pcap/smallFlows.pcap").size, P2: statSync("test/real-data/pcap/bigFlows_prefix24MB.pcap").size, P3: statSync("test/real-data/pcap/http.cap").size, P4: statSync("test/real-data/pcap/dhcpv6_1.pcap").size, P5: statSync("test/real-data/pcap/sip-rtp-opus-hybrid.pcap").size, P6: statSync("test/real-data/pcap/STP_UplinkFast.pcapng").size }
report("PRE-REGISTRADO (regla literal)", merged, sizes)
report("POST HOC (UCI con '?' = vacío; no mezclar con lo anterior)", parseFile(POST), {})
