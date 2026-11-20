// Exp. 14: sobrecarga del contenedor y determinismo (sobre un prefijo de 3 MB de smallFlows, desarrollo).
import { readFileSync } from "fs"
import { createHash } from "crypto"
import { encodePcap, decodePcap } from "../src/lab/pcapcodec"
const f = new Uint8Array(readFileSync("test/real-data/pcap/smallFlows.pcap"))
let p = 24; while (p + 16 <= f.length) { const incl = f[p + 8]! | (f[p + 9]! << 8) | (f[p + 10]! << 16); if (p + 16 + incl > 3_000_000) break; p += 16 + incl }
const pre = f.subarray(0, p), h = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16)
const a = encodePcap(pre, "ck"), b = encodePcap(pre, "ck")
const sum = Object.values(a.stats.streams).reduce((x, y) => x + y, 0), nStreams = Object.keys(a.stats.streams).length
console.log(`prefijo ${pre.length} B; salida ${a.out.length} B; ${nStreams} flujos; suma de flujos ${sum} B; sobrecarga del contenedor (cabecera + longitudes) ${a.out.length - sum} B = ${(100 * (a.out.length - sum) / a.out.length).toFixed(4)} %`)
console.log(`determinismo: dos codificaciones idénticas = ${h(a.out) === h(b.out)} (${h(a.out)}); reconstrucción exacta = ${Buffer.compare(Buffer.from(decodePcap(a.out)), Buffer.from(pre)) === 0}`)
