// W1: Algex actual sobre un archivo completo, en proceso aislado. Escribe JSON {bytes, ms, decMs, exact, error}.
//   npx tsx scripts/lab-19b-algex-file.ts <ruta> <salida.json> [fast|balanced|max]
import { readFileSync, writeFileSync } from "fs"
import { compress, decompress } from "../src/index"

const [path, out, mode = "max"] = [process.argv[2]!, process.argv[3]!, (process.argv[4] ?? "max") as "fast" | "balanced" | "max"]
const buf = readFileSync(path), file = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
const res: { mode: string; bytes?: number; ms?: number; decMs?: number; exact?: boolean; error?: string } = { mode }
try {
  const t = Date.now(); const c = compress(file, mode); res.ms = Date.now() - t; res.bytes = c.length
  const t2 = Date.now(); const d = decompress(c); res.decMs = Date.now() - t2; res.exact = Buffer.compare(Buffer.from(d), buf) === 0
} catch (e) { res.error = String((e as Error).message) }
writeFileSync(out, JSON.stringify(res)); console.log(JSON.stringify(res))
