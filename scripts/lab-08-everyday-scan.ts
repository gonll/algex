// Experimento 08 — ¿cuánta estructura matemática EXACTA hay en archivos cotidianos reales?
// Por categoría: (a) línea base compress() vs brotli-11 / zstd-19 (concatenado hasta 1 MiB) y
// (b) cobertura de detectores exactos sobre ventanas de 4 KiB (hasta 64 ventanas por archivo).
// Un detector "explica" una ventana si la reconstruye sin residual a un costo < 1/4 del crudo.
//   npx tsx scripts/lab-08-everyday-scan.ts
import * as fs from "fs"; import * as zlib from "zlib"
import { compress, decompress } from "../src/index"
import { addon } from "../src/native/addon"
import { exactGateBytes, synthLfsr2, bytesToBits, costLfsr2 } from "../src/core/bit-lfsr"

const W = 4096
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(a, b) === 0
const rd = (f: string) => new Uint8Array(fs.readFileSync(f))
const walk = (dir: string, re: RegExp, out: string[] = []): string[] => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = dir + "/" + e.name; if (e.isDirectory()) walk(p, re, out); else if (re.test(p)) out.push(p) } return out }

const cats: Record<string, string[]> = {
  "código TS (repo+lib.d.ts)": ["README.md", "node_modules/typescript/lib/lib.dom.d.ts", ...walk("src", /\.ts$/).slice(0, 12)],
  "JS minificado/bundles": ["node_modules/@babel/parser/lib/index.js", "node_modules/rollup/dist/shared/rollup.js", "node_modules/chai/chai.js"],
  "JSON": ["package-lock.json", "node_modules/typescript/lib/cs/diagnosticMessages.generated.json", "node_modules/tr46/lib/mappingTable.json"],
  "source maps (VLQ)": ["node_modules/@babel/parser/lib/index.js.map", "node_modules/@babel/generator/lib/printer.js.map", "node_modules/@babel/types/lib/asserts/generated/index.js.map"],
  "ejecutables nativos": ["node_modules/@esbuild/win32-x64/esbuild.exe", "node_modules/@rollup/rollup-win32-x64-msvc/rollup.win32-x64-msvc.node"],
  "firmware/kernel (RPi)": ["test/real-data/firmware/kernel8.img", "test/real-data/firmware/start.elf", "test/real-data/firmware/bootcode.bin", "test/real-data/firmware/fixup.dat"],
  "imagen JPEG": ["test/real-data/image/nasa_pia23122.jpg"],
  "pcap (capturas de red)": walk("test/real-data/pcap", /./),
  "[ref. positiva] PRBS reales": walk("test/real-data/prbs", /\.bin$/),
}

// ── detectores exactos ──
const isConst = (w: Uint8Array) => { for (let i = 1; i < w.length; i++) if (w[i] !== w[0]) return false; return true }
const cyclic = (w: Uint8Array): boolean => { for (let P = 1; P <= 512; P++) { let ok = true; for (let i = P; i < w.length; i++) if (w[i] !== w[i - P]) { ok = false; break } if (ok) return true } return false }
const gf256 = (w: Uint8Array): boolean => addon.bmSolve(Buffer.from(w)).length <= 16
const bitLfsr = (w: Uint8Array): boolean => {
  for (const msb of [true, false]) {
    if (!exactGateBytes(w, msb)) continue
    const m = synthLfsr2(bytesToBits(w, msb), 4096)
    if (m && m.L > 0 && Math.ceil(costLfsr2(m) / 8) < w.length / 4) return true
  }
  return false
}
// polinomio de grado <= 3 módulo 2^(8w) sobre palabras little-endian de w bytes (4ª diferencia = 0)
const polyWords = (w: Uint8Array, wb: 1 | 2 | 4): boolean => {
  const n = Math.floor(w.length / wb), v = new Array<number>(n)
  for (let i = 0; i < n; i++) { let x = 0; for (let k = wb - 1; k >= 0; k--) x = x * 256 + w[i * wb + k]!; v[i] = x }
  const mod = 2 ** (8 * wb)
  let cur = v
  for (let d = 0; d < 4; d++) { const nx = new Array<number>(cur.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = ((cur[i + 1]! - cur[i]!) % mod + mod) % mod; cur = nx }
  for (const x of cur) if (x !== 0) return false
  return true
}
// columnas con stride s (tablas de registros): fracción de columnas-byte que son polinomio grado <= 2 exacto (3ª diferencia = 0)
const columnar = (w: Uint8Array): number => {
  let best = 0
  for (const s of [2, 3, 4, 6, 8, 12, 16, 20, 24, 32]) {
    let exact = 0
    for (let o = 0; o < s; o++) {
      const col: number[] = []; for (let i = o; i < w.length; i += s) col.push(w[i]!)
      let cur = col
      for (let d = 0; d < 3; d++) { const nx = new Array<number>(cur.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = (cur[i + 1]! - cur[i]! + 256) & 255; cur = nx }
      if (cur.every(x => x === 0)) exact++
    }
    best = Math.max(best, exact / s)
  }
  return best
}

console.log("categoría                    | bytes   | Algex   | brotli11| zstd19  | Algex/brotli | ventanas | const/cíclico | GF256 | bit-LFSR | poly(1/2/4B) | columnas≥90% | columnas≥50% | cualquiera NO trivial")
const rows: string[] = []
for (const [cat, files] of Object.entries(cats)) {
  const parts: Uint8Array[] = []
  let wins = 0, triv = 0, g = 0, b = 0, pl = 0, c90 = 0, c50 = 0, any = 0
  for (const f of files) {
    if (!fs.existsSync(f)) continue
    const d = rd(f)
    parts.push(d.subarray(0, 1 << 18))
    const nW = Math.floor(d.length / W), step = Math.max(1, Math.floor(nW / 64))
    for (let k = 0; k < nW; k += step) {
      const w = d.subarray(k * W, (k + 1) * W)
      wins++
      const t = isConst(w) || cyclic(w)
      const gg = !t && gf256(w), bb = !t && bitLfsr(w), pp = !t && (polyWords(w, 1) || polyWords(w, 2) || polyWords(w, 4))
      const col = columnar(w)
      if (t) triv++
      if (gg) g++; if (bb) b++; if (pp) pl++
      if (!t && col >= 0.9) c90++
      if (!t && col >= 0.5) c50++
      if (!t && (gg || bb || pp || col >= 0.9)) any++
    }
  }
  const data = parts.reduce((a, p) => { const o = new Uint8Array(a.length + p.length); o.set(a); o.set(p, a.length); return o }, new Uint8Array(0)).subarray(0, 1 << 20)
  const ax = compress(data), okAx = eq(decompress(ax), data)
  const br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  const zs = (zlib as any).zstdCompressSync(data, { params: { [(zlib as any).constants.ZSTD_c_compressionLevel]: 19 } }).length
  const pct = (x: number) => `${(100 * x / wins).toFixed(1)}%`.padStart(6)
  console.log(`${cat.padEnd(28)} | ${String(data.length).padStart(7)} | ${String(ax.length).padStart(7)}${okAx ? " " : "✗"}| ${String(br).padStart(7)} | ${String(zs).padStart(7)} | ${(ax.length / br).toFixed(3).padStart(12)} | ${String(wins).padStart(8)} | ${pct(triv).padStart(13)} | ${pct(g)} | ${pct(b).padStart(8)} | ${pct(pl).padStart(12)} | ${pct(c90).padStart(12)} | ${pct(c50).padStart(12)} | ${pct(any)}`)
}
