// Exp. 14 — PCAP completos: brotli (W0) vs Algex (W1, aparte) vs códec columnar W2..W5 con decodificador real.
//   npx tsx scripts/lab-19-pcap.ts <etiqueta> <ruta.pcap> [W1.json]
// Mide tamaño, reconstrucción exacta, tiempos de codificación/decodificación (mediana de 3 decodificaciones) y atribución del ahorro.
import { readFileSync } from "fs"
import { createHash } from "crypto"
import { encodePcap, decodePcap, brotliFile, parsePcap, Arm } from "../src/lab/pcapcodec"

const [label, path, w1Path] = [process.argv[2] ?? "?", process.argv[3]!, process.argv[4]]
const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8)
const buf = readFileSync(path), file = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
console.log(`Exp. 14 ${label}: ${path} (${file.length} bytes, sha256 ${createHash("sha256").update(file).digest("hex").slice(0, 12)}). pcapcodec=${hash("src/lab/pcapcodec.ts")} encoder=${hash("src/codec/encoder.ts")}\n`)
const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!
const kb = (n: number) => `${n}`.padStart(10)
const t0 = Date.now(), P = parsePcap(file), parseMs = Date.now() - t0
if (P) console.log(`análisis: ${P.n} paquetes, IPv4 ${P.stats.v4}, IPv6 ${P.stats.v6}, TCP ${P.stats.tcp}, UDP ${P.stats.udp}, crudos ${P.stats.raw} (${(100 * P.stats.raw / P.n).toFixed(1)} %), enlace ${P.link}, tiempo de análisis ${parseMs} ms; carga útil ${P.payload.length} B, rawpk ${P.rawpk.length} B, opts ${P.opts4.length + P.optsT.length} B (${(100 * P.payload.length / file.length).toFixed(1)} % del archivo es carga útil)`)
else console.log("archivo no soportado: el códec cae a brotli")

let w0 = 0, w0ms = 0, w0dec = 0
{ const t = Date.now(); const o = brotliFile(file); w0ms = Date.now() - t; w0 = o.length; const ds: number[] = []; for (let i = 0; i < 3; i++) { const t2 = Date.now(); require("zlib").brotliDecompressSync(o); ds.push(Date.now() - t2) } w0dec = med(ds) }
let w1 = NaN, w1ms = NaN, w1err = ""
if (w1Path) { try { const j = JSON.parse(readFileSync(w1Path, "utf8")); w1 = j.bytes ?? NaN; w1ms = j.ms ?? NaN; w1err = j.error ?? "" } catch { w1err = "sin W1" } }
console.log("\nbrazo".padEnd(30), "bytes".padStart(10), "| vs W0 | exacto | enc ms | dec ms | selec ms")
console.log("W0 brotli-11 (lgwin 24)".padEnd(30), kb(w0), "|  —    |   —    |", `${w0ms}`.padStart(6), "|", `${w0dec}`.padStart(6), "|")
console.log("W1 Algex max (archivo)".padEnd(30), kb(w1), "|", Number.isFinite(w1) ? `${(100 * (w1 - w0) / w0).toFixed(2)}%` : "—", "|  —    |", `${Number.isFinite(w1ms) ? w1ms : "—"}`.padStart(6), "|   —    |", w1err)
const sizes: Record<string, number> = {}, streams: Record<string, Record<string, number>> = {}
for (const [nm, arm] of [["W2 col", "col"], ["W3 col+gen", "gen"], ["W4 ctx", "ctx"], ["W5 ctx+ck", "ck"]] as [string, Arm][]) {
  const { out, stats } = encodePcap(file, arm)
  const ds: number[] = []; let ok = true
  for (let i = 0; i < 3; i++) { const t = Date.now(); const d = decodePcap(out); ds.push(Date.now() - t); if (i === 0) ok = Buffer.compare(Buffer.from(d), buf) === 0 }
  sizes[nm] = out.length; streams[nm] = stats.streams
  console.log(nm.padEnd(30), kb(out.length), "|", `${(100 * (out.length - w0) / w0).toFixed(2)}%`.padStart(7), "|", ok ? "  sí  " : " NO!! ", "|", `${stats.encodeMs}`.padStart(6), "|", `${med(ds)}`.padStart(6), "|", `${stats.selectMs}`.padStart(6), stats.timeCombined ? "(tiempo combinado)" : "")
}
console.log("\nAtribución del ahorro (bytes y % de W0):")
const steps: [string, number, number][] = [["conocer la disposición (W0→W2)", w0, sizes["W2 col"]!], ["predicción genérica sin protocolo (W2→W3)", sizes["W2 col"]!, sizes["W3 col+gen"]!], ["estado/semántica TCP-IP (W3→W4)", sizes["W3 col+gen"]!, sizes["W4 ctx"]!], ["álgebra de checksums (W4→W5)", sizes["W4 ctx"]!, sizes["W5 ctx+ck"]!]]
for (const [nm, a, b] of steps) console.log(`  ${nm.padEnd(46)} ${String(a - b).padStart(10)} B  ${(100 * (a - b) / w0).toFixed(2)} %`)
const best = Math.min(w0, Number.isFinite(w1) ? w1 : Infinity), w5 = sizes["W5 ctx+ck"]!
console.log(`\nMEJORA NETA NI = 1 − W5 / min(W0,W1) = ${(100 * (1 - w5 / best)).toFixed(2)} %   (W5 ${w5} B vs min(W0,W1) ${best} B${Number.isFinite(w1) ? "" : "; W1 no medido: NI contra W0"})`)
console.log("\nFlujos más grandes por brazo (bytes):")
for (const nm of Object.keys(streams)) console.log(`  ${nm.padEnd(12)} ` + Object.entries(streams[nm]!).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join("  "))
