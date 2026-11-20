// Exp. 13 — análisis EXPLORATORIO POST HOC: ¿ayudaría un predictor con CONTEXTO + residual donde las fórmulas del índice no sirven?
// Se eligió tras ver que los predictores por índice no ganan; los predictores se fijan por conocimiento de protocolo, no por mirar resultados.
//   ip.id  : por IP origen, esperado = último id de ese origen + 1
//   tcp.seq: por flujo (src,dst,sport,dport), esperado = último seq + carga útil (+1 si SYN/FIN)
//   tcp.ack: por flujo, esperado = último ack del flujo (los ack no decrecen)
// Costo = 256 bits (descripción del predictor) + META + brotli(residual en zigzag, por planos). Se compara con min(B0..B3) de la columna original.
// NO se integra nada; es un diagnóstico de potencial.
import { readFileSync } from "fs"
import { makeColumn, MIN_N } from "../src/lab/columns"
import { baselines, brotli } from "../src/lab/realfit"
import { gammaBits } from "../src/lab/decimate"

interface Pk { src: number; id: number; ip: boolean; flow?: string; seq?: number; ack?: number; plen?: number; synfin?: number }
const parse = (buf: Buffer): Pk[] => {
  const le = buf.readUInt32BE(0) === 0xd4c3b2a1, out: Pk[] = []; let p = 24
  while (p + 16 <= buf.length) {
    const incl = le ? buf.readUInt32LE(p + 8) : buf.readUInt32BE(p + 8); if (p + 16 + incl > buf.length) break
    const d = buf.subarray(p + 16, p + 16 + incl); p += 16 + incl
    if (d.length < 34 || d.readUInt16BE(12) !== 0x0800 || (d[14]! >> 4) !== 4) continue
    const ihl = (d[14]! & 15) * 4, ipLen = d.readUInt16BE(16), src = d.readUInt32BE(26), dst = d.readUInt32BE(30), id = d.readUInt16BE(18)
    const pk: Pk = { src, id, ip: true }
    if (d[23] === 6 && ihl >= 20 && (d.readUInt16BE(20) & 0x1fff) === 0 && d.length >= 14 + ihl + 20) {
      const b = 14 + ihl, doff = (d[b + 12]! >> 4) * 4, flags = d[b + 13]!
      pk.flow = `${src}>${dst}:${d.readUInt16BE(b)}>${d.readUInt16BE(b + 2)}`; pk.seq = d.readUInt32BE(b + 4); pk.ack = d.readUInt32BE(b + 8)
      pk.plen = Math.max(0, ipLen - ihl - doff); pk.synfin = (flags & 0x03) ? 1 : 0
    }
    out.push(pk)
  }
  return out
}
const zig = (r: bigint): bigint => (r >= 0n ? 2n * r : -2n * r - 1n)
const costRes = (res: bigint[], mod: bigint, w: number): number => {
  const planes = Array.from({ length: w + 1 }, () => new Uint8Array(res.length))
  res.forEach((r0, i) => { let r = ((r0 % mod) + mod) % mod; if (r > mod / 2n) r -= mod; let v = zig(r); for (let q = 0; q <= w; q++) { planes[q]![i] = Number(v & 255n); v >>= 8n } })
  const all = new Uint8Array(planes.length * res.length); planes.forEach((pl, q) => all.set(pl, q * res.length))
  return brotli(all)
}
for (const [name, path] of [["P1 smallFlows", "test/real-data/pcap/smallFlows.pcap"], ["P2 bigFlows(24MB)", "test/real-data/pcap/bigFlows_prefix24MB.pcap"]] as const) {
  const pk = parse(readFileSync(path)); console.log(`\n== ${name}: ${pk.length} paquetes IPv4, ${pk.filter((x) => x.flow).length} TCP`)
  const rows: [string, bigint[], bigint[], bigint, number][] = []
  // ip.id
  { const last = new Map<number, number>(), orig: bigint[] = [], res: bigint[] = []
    for (const x of pk) { orig.push(BigInt(x.id)); res.push(BigInt(x.id - ((last.get(x.src) ?? -1) + 1))); last.set(x.src, x.id) }
    rows.push(["ip.id (origen: último+1)", orig, res, 1n << 16n, 2]) }
  const tcp = pk.filter((x) => x.flow)
  { const last = new Map<string, number>(), orig: bigint[] = [], res: bigint[] = []
    for (const x of tcp) { orig.push(BigInt(x.seq!)); const l = last.get(x.flow!); res.push(l === undefined ? BigInt(x.seq!) : BigInt(x.seq!) - BigInt(l)); last.set(x.flow!, (x.seq! + x.plen! + x.synfin!) >>> 0) }
    rows.push(["tcp.seq (flujo: último seq+carga)", orig, res, 1n << 32n, 4]) }
  { const last = new Map<string, number>(), orig: bigint[] = [], res: bigint[] = []
    for (const x of tcp) { orig.push(BigInt(x.ack!)); const l = last.get(x.flow!); res.push(l === undefined ? BigInt(x.ack!) : BigInt(x.ack!) - BigInt(l)); last.set(x.flow!, x.ack!) }
    rows.push(["tcp.ack (flujo: último ack)", orig, res, 1n << 32n, 4]) }
  console.log("columna".padEnd(36), "n".padStart(6), "| min(B0..B3)".padStart(14), "| pred+resid".padStart(12), "| ahorro")
  for (const [label, orig, res, mod, w] of rows) {
    const c = makeColumn("x", label, orig)!; if (c.n < MIN_N) continue
    const b = baselines(c), base = Math.min(b.b0, b.b1, b.b2, b.b3) + 64 + gammaBits(c.n) + gammaBits(c.w)
    const pr = 256 + 64 + gammaBits(c.n) + gammaBits(c.w) + costRes(res, mod, w), zeros = res.filter((r) => r === 0n).length
    console.log(label.padEnd(36), String(c.n).padStart(6), `| ${base.toFixed(0)}`.padStart(14), `| ${pr.toFixed(0)}`.padStart(12), `| ${(100 * (base - pr) / base).toFixed(1)}%  (residuos 0: ${(100 * zeros / res.length).toFixed(1)}%)`)
  }
}
