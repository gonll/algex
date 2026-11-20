// Aísla el fallo de Algex (RangeError en format.ts writeChunk) hallado con una columna real de UCI (exp. 13). NO corrige nada.
//   npx tsx scripts/lab-18b-algex-crash.ts
import { openSync, readSync, closeSync } from "fs"
import { compress, decompress } from "../src/index"
import { csvColumns, columnBytes } from "../src/lab/columns"

const fd = openSync("test/real-data/numeric/uci/household_power_consumption.txt", "r"), b = Buffer.alloc(9_000_000), n = readSync(fd, b, 0, b.length, 0); closeSync(fd)
const text = b.subarray(0, n).toString("utf8"); const t = text.slice(0, text.lastIndexOf("\n"))
const col = csvColumns("UCI", t, ";", 65536, "?").columns.find((c) => c.name === "Sub_metering_1")!
const all = columnBytes(col)
const tryC = (len: number, mode: "fast" | "balanced" | "max"): string => {
  const x = all.subarray(0, len)
  try { const o = compress(x, mode); const ok = Buffer.compare(Buffer.from(decompress(o)), Buffer.from(x)) === 0; return ok ? `ok ${o.length}` : "ROUND-TRIP MAL" } catch (e) { return `ERROR ${(e as Error).message}` }
}
console.log(`Sub_metering_1: ${all.length} bytes (n=${col.n}, w=${col.w})`)
for (const mode of ["fast", "balanced", "max"] as const) console.log(`  ${mode.padEnd(9)} completo: ${tryC(all.length, mode)}`)
// bisección del prefijo más corto que falla con "max"
if (tryC(all.length, "max").startsWith("ERROR")) {
  let lo = 1, hi = all.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tryC(mid, "max").startsWith("ERROR")) hi = mid; else lo = mid + 1 }
  console.log(`  prefijo mínimo que falla con "max": ${lo} bytes (con ${lo - 1} bytes: ${tryC(lo - 1, "max")})`)
}
