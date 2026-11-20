// Códec de laboratorio para PCAP completos con decodificador REAL (exp. 14). No se integra al encoder.
// Brazos: "col" (solo disposición), "gen" (+ delta genérico), "ctx" (+ predictores con estado TCP/IP),
//         "ck" (+ recomputar checksums). Ver docs/research/prereg-pcap.md. decode(encode(f)) == f byte a byte.
import * as zlib from "zlib"

export type Arm = "col" | "gen" | "ctx" | "ck"
const ARMS: Arm[] = ["col", "gen", "ctx", "ck"]

// ── brotli ─────────────────────────────────────────────────────────────────────────────────────
const bro = (b: Uint8Array, q: number): Uint8Array => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } })
export const brotliFile = (b: Uint8Array): Uint8Array => bro(b, 11)

class ByteBuf {
  a = new Uint8Array(1 << 16); n = 0
  ensure(k: number) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new Uint8Array(m); b.set(this.a.subarray(0, this.n)); this.a = b } }
  push(src: Uint8Array, s: number, e: number) { const k = e - s; if (k <= 0) return; this.ensure(k); this.a.set(src.subarray(s, e), this.n); this.n += k }
  u8(v: number) { this.ensure(1); this.a[this.n++] = v }
  out(): Uint8Array { return this.a.subarray(0, this.n) }
}
const putVar = (w: ByteBuf, v: number) => { while (v >= 128) { w.u8((v % 128) | 128); v = Math.floor(v / 128) } w.u8(v) }
class Rd {
  p = 0
  constructor(public b: Uint8Array) {}
  u8() { return this.b[this.p++]! }
  varint() { let v = 0, m = 1; for (;;) { const x = this.u8(); v += (x & 127) * m; if (x < 128) return v; m *= 128 } }
  take(k: number) { const s = this.b.subarray(this.p, this.p + k); this.p += k; return s }
}

// ── lectura de campos ──────────────────────────────────────────────────────────────────────────
const be16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!
const be32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
const rd32 = (b: Uint8Array, o: number, le: boolean) => (le ? ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0 : be32(b, o))
const wr32 = (b: Uint8Array, o: number, v: number, le: boolean) => { if (le) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255 } else { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255 } }
const w16 = (b: Uint8Array, o: number, v: number) => { b[o] = (v >>> 8) & 255; b[o + 1] = v & 255 }
const w32 = (b: Uint8Array, o: number, v: number) => { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255 }

// clases por paquete (bits)
const C_ETH = 1, C_V4 = 2, C_V6 = 4, C_TCP = 8, C_UDP = 16

// columnas numéricas (anchura en bytes) y presencia
interface NumSpec { name: string; w: number; pres: number }   // pres: máscara de bits de cls (0 = todos los paquetes)
const NUM: NumSpec[] = [
  { name: "eth.type", w: 2, pres: C_ETH },
  { name: "ip4.ver_ihl", w: 1, pres: C_V4 }, { name: "ip4.src", w: 4, pres: C_V4 }, { name: "ip4.dst", w: 4, pres: C_V4 }, { name: "ip4.tos", w: 1, pres: C_V4 },
  { name: "ip4.len", w: 2, pres: C_V4 }, { name: "ip4.id", w: 2, pres: C_V4 }, { name: "ip4.frag", w: 2, pres: C_V4 }, { name: "ip4.ttl", w: 1, pres: C_V4 },
  { name: "ip4.proto", w: 1, pres: C_V4 }, { name: "ip4.cksum", w: 2, pres: C_V4 },
  { name: "ip6.vtf", w: 4, pres: C_V6 }, { name: "ip6.plen", w: 2, pres: C_V6 }, { name: "ip6.nh", w: 1, pres: C_V6 }, { name: "ip6.hop", w: 1, pres: C_V6 },
  { name: "tcp.sport", w: 2, pres: C_TCP }, { name: "tcp.dport", w: 2, pres: C_TCP }, { name: "tcp.off", w: 2, pres: C_TCP }, { name: "tcp.seq", w: 4, pres: C_TCP },
  { name: "tcp.ack", w: 4, pres: C_TCP }, { name: "tcp.win", w: 2, pres: C_TCP }, { name: "tcp.urg", w: 2, pres: C_TCP }, { name: "tcp.cksum", w: 2, pres: C_TCP },
  { name: "udp.sport", w: 2, pres: C_UDP }, { name: "udp.dport", w: 2, pres: C_UDP }, { name: "udp.len", w: 2, pres: C_UDP }, { name: "udp.cksum", w: 2, pres: C_UDP },
  { name: "rec.incl", w: 4, pres: 0 }, { name: "rec.orig", w: 4, pres: 0 }, { name: "rec.ts_sec", w: 4, pres: 0 }, { name: "rec.ts_frac", w: 4, pres: 0 },
]
interface ByteSpec { name: string; w: number; pres: number }
const BYTES: ByteSpec[] = [{ name: "eth.dst", w: 6, pres: C_ETH }, { name: "eth.src", w: 6, pres: C_ETH }, { name: "ip6.src", w: 16, pres: C_V6 }, { name: "ip6.dst", w: 16, pres: C_V6 }]
const CKCOLS = ["ip4.cksum", "tcp.cksum", "udp.cksum"]

export interface Parsed {
  le: boolean; unit: number; link: number; n: number; globalHdr: Uint8Array; tail: Uint8Array
  cls: Uint8Array
  num: Record<string, Float64Array>
  bytes: Record<string, Uint8Array>             // n*w filas (solo las presentes se rellenan)
  opts4: Uint8Array; optsT: Uint8Array; payload: Uint8Array; rawpk: Uint8Array
  stats: { raw: number; v4: number; v6: number; tcp: number; udp: number }
}
const newParsed = (n: number): Parsed => {
  const num: Record<string, Float64Array> = {}, bytes: Record<string, Uint8Array> = {}
  for (const s of NUM) num[s.name] = new Float64Array(n)
  for (const s of BYTES) bytes[s.name] = new Uint8Array(n * s.w)
  return { le: true, unit: 1e6, link: 1, n, globalHdr: new Uint8Array(24), tail: new Uint8Array(0), cls: new Uint8Array(n), num, bytes, opts4: new Uint8Array(0), optsT: new Uint8Array(0), payload: new Uint8Array(0), rawpk: new Uint8Array(0), stats: { raw: 0, v4: 0, v6: 0, tcp: 0, udp: 0 } }
}
const magicInfo = (f: Uint8Array): { le: boolean; unit: number } | null => {
  if (f.length < 24) return null
  const m = be32(f, 0)
  if (m === 0xd4c3b2a1) return { le: true, unit: 1e6 }
  if (m === 0xa1b2c3d4) return { le: false, unit: 1e6 }
  if (m === 0x4d3cb2a1) return { le: true, unit: 1e9 }
  if (m === 0xa1b23c4d) return { le: false, unit: 1e9 }
  return null
}

/** Analiza un pcap clásico. null si no es soportado (magic distinto, enlace distinto de 1/101 o sin paquetes). */
export const parsePcap = (f: Uint8Array): Parsed | null => {
  const mi = magicInfo(f); if (!mi) return null
  const link = rd32(f, 20, mi.le); if (link !== 1 && link !== 101) return null
  // contar paquetes completos
  let p = 24, n = 0
  while (p + 16 <= f.length) { const incl = rd32(f, p + 8, mi.le); if (p + 16 + incl > f.length) break; p += 16 + incl; n++ }
  if (n === 0) return null
  const P = newParsed(n); P.le = mi.le; P.unit = mi.unit; P.link = link; P.globalHdr = f.slice(0, 24); P.tail = f.slice(p)
  const opts4 = new ByteBuf(), optsT = new ByteBuf(), payload = new ByteBuf(), rawpk = new ByteBuf()
  let q = 24
  for (let i = 0; i < n; i++) {
    const incl = rd32(f, q + 8, mi.le)
    P.num["rec.ts_sec"]![i] = rd32(f, q, mi.le); P.num["rec.ts_frac"]![i] = rd32(f, q + 4, mi.le); P.num["rec.incl"]![i] = incl; P.num["rec.orig"]![i] = rd32(f, q + 12, mi.le)
    let o = q + 16; const end = o + incl; q = end
    let cls = 0, net = 0
    if (link === 1) {
      if (incl >= 14) { cls |= C_ETH; P.bytes["eth.dst"]!.set(f.subarray(o, o + 6), i * 6); P.bytes["eth.src"]!.set(f.subarray(o + 6, o + 12), i * 6); const et = be16(f, o + 12); P.num["eth.type"]![i] = et; o += 14; net = et === 0x0800 ? 4 : et === 0x86dd ? 6 : 0 }
    } else if (end - o >= 1) { const v = f[o]! >> 4; net = v === 4 || v === 6 ? v : 0 }
    let l4 = 0, nh = 0, ipOk = false
    if (net === 4 && end - o >= 20 && (f[o]! >> 4) === 4) {
      const ihl = (f[o]! & 15) * 4
      if (ihl >= 20 && ihl <= end - o) {
        ipOk = true; cls |= C_V4
        P.num["ip4.ver_ihl"]![i] = f[o]!; P.num["ip4.tos"]![i] = f[o + 1]!; P.num["ip4.len"]![i] = be16(f, o + 2); P.num["ip4.id"]![i] = be16(f, o + 4); P.num["ip4.frag"]![i] = be16(f, o + 6)
        P.num["ip4.ttl"]![i] = f[o + 8]!; P.num["ip4.proto"]![i] = f[o + 9]!; P.num["ip4.cksum"]![i] = be16(f, o + 10); P.num["ip4.src"]![i] = be32(f, o + 12); P.num["ip4.dst"]![i] = be32(f, o + 16)
        opts4.push(f, o + 20, o + ihl)
        if ((be16(f, o + 6) & 0x1fff) === 0) nh = f[o + 9]!; else nh = 0
        o += ihl
      }
    } else if (net === 6 && end - o >= 40 && (f[o]! >> 4) === 6) {
      ipOk = true; cls |= C_V6
      P.num["ip6.vtf"]![i] = be32(f, o); P.num["ip6.plen"]![i] = be16(f, o + 4); P.num["ip6.nh"]![i] = f[o + 6]!; P.num["ip6.hop"]![i] = f[o + 7]!
      P.bytes["ip6.src"]!.set(f.subarray(o + 8, o + 24), i * 16); P.bytes["ip6.dst"]!.set(f.subarray(o + 24, o + 40), i * 16)
      nh = f[o + 6]!; o += 40
    }
    if (ipOk) {
      if (nh === 6 && end - o >= 20) {
        const doff = (f[o + 12]! >> 4) * 4
        if (doff >= 20 && doff <= end - o) {
          l4 = C_TCP
          P.num["tcp.sport"]![i] = be16(f, o); P.num["tcp.dport"]![i] = be16(f, o + 2); P.num["tcp.seq"]![i] = be32(f, o + 4); P.num["tcp.ack"]![i] = be32(f, o + 8)
          P.num["tcp.off"]![i] = be16(f, o + 12); P.num["tcp.win"]![i] = be16(f, o + 14); P.num["tcp.cksum"]![i] = be16(f, o + 16); P.num["tcp.urg"]![i] = be16(f, o + 18)
          optsT.push(f, o + 20, o + doff); o += doff
        }
      } else if (nh === 17 && end - o >= 8) {
        l4 = C_UDP
        P.num["udp.sport"]![i] = be16(f, o); P.num["udp.dport"]![i] = be16(f, o + 2); P.num["udp.len"]![i] = be16(f, o + 4); P.num["udp.cksum"]![i] = be16(f, o + 6); o += 8
      }
      payload.push(f, o, end)
    } else rawpk.push(f, o, end)
    cls |= l4; P.cls[i] = cls
    if (!ipOk) P.stats.raw++; else { if (cls & C_V4) P.stats.v4++; else P.stats.v6++; if (l4 === C_TCP) P.stats.tcp++; else if (l4 === C_UDP) P.stats.udp++ }
  }
  P.opts4 = opts4.out().slice(); P.optsT = optsT.out().slice(); P.payload = payload.out().slice(); P.rawpk = rawpk.out().slice()
  return P
}

// ── predictores ────────────────────────────────────────────────────────────────────────────────
interface Ctx { n: number; P: Parsed; flowKey(i: number): string; revKey(i: number): string; hdrBytes(i: number): number }
interface Predictor { predict(i: number): number; observe(i: number, v: number): void }
type Factory = (c: Ctx, M: number) => Predictor
const last = (k = 0) => k  // marcador
void last
const rawP: Factory = () => ({ predict: () => 0, observe: () => {} })
const deltaP: Factory = () => { let a = 0; return { predict: () => a, observe: (_i, v) => { a = v } } }
const delta2P: Factory = (_c, M) => { let a = 0, b = 0; return { predict: () => (((2 * a - b) % M) + M) % M, observe: (_i, v) => { b = a; a = v } } }

const lenOfIp = (c: Ctx, i: number): number => {   // longitud IP total (v4) o 40 + plen (v6) o -1
  const k = c.P.cls[i]!
  if (k & C_V4) return c.P.num["ip4.len"]![i]!
  if (k & C_V6) return 40 + c.P.num["ip6.plen"]![i]!
  return -1
}
const linkLen = (c: Ctx, i: number) => (c.P.cls[i]! & C_ETH ? 14 : 0)
const l4Len = (c: Ctx, i: number): number => {      // longitud del segmento L4 según cabecera IP
  const k = c.P.cls[i]!
  if (k & C_V4) return c.P.num["ip4.len"]![i]! - (c.P.num["ip4.ver_ihl"]![i]! & 15) * 4
  if (k & C_V6) return c.P.num["ip6.plen"]![i]!
  return 0
}
const plenOf = (c: Ctx, i: number): number => Math.max(0, l4Len(c, i) - (c.P.num["tcp.off"]![i]! >> 12) * 4)

const SPECIAL: Record<string, Record<number, Factory>> = {
  "rec.incl": { 10: (c) => { let prev = 0; return { predict: (i) => { const L = lenOfIp(c, i); return L >= 0 ? linkLen(c, i) + L : prev }, observe: (_i, v) => { prev = v } } } },
  "rec.orig": { 11: (c) => ({ predict: (i) => c.P.num["rec.incl"]![i]!, observe: () => {} }) },
  "udp.len": { 12: (c) => ({ predict: (i) => l4Len(c, i), observe: () => {} }) },
  "ip4.id": { 14: (c) => { const m = new Map<number, number>(); return { predict: (i) => ((m.get(c.P.num["ip4.src"]![i]!) ?? -1) + 1) & 0xffff, observe: (i, v) => { m.set(c.P.num["ip4.src"]![i]!, v) } } } },
  "tcp.seq": { 15: (c) => { const m = new Map<string, number>(); return { predict: (i) => m.get(c.flowKey(i)) ?? 0, observe: (i, v) => { const fl = c.P.num["tcp.off"]![i]! & 0xff; m.set(c.flowKey(i), (v + plenOf(c, i) + ((fl & 3) ? 1 : 0)) >>> 0) } } } },
  "tcp.ack": {
    16: (c) => { const m = new Map<string, number>(); return { predict: (i) => m.get(c.flowKey(i)) ?? 0, observe: (i, v) => { m.set(c.flowKey(i), v) } } },
    17: (c) => ({ predict: () => 0, observe: () => {} }),   // se sustituye abajo (necesita estado de seq del flujo contrario)
  },
}
// 17: siguiente seq esperado del sentido contrario; requiere el seq ya decodificado (tcp.seq va antes que tcp.ack)
SPECIAL["tcp.ack"]![17] = (c) => {
  const nxt = new Map<string, number>(), seen = new Set<number>()
  const upto = (i: number) => { /* acumula seq+plen+synfin de todos los paquetes TCP anteriores a i */ }
  void upto; void seen
  let done = -1
  const advance = (i: number) => { for (let j = done + 1; j < i; j++) if (c.P.cls[j]! & C_TCP) { const fl = c.P.num["tcp.off"]![j]! & 0xff; nxt.set(c.flowKey(j), (c.P.num["tcp.seq"]![j]! + plenOf(c, j) + ((fl & 3) ? 1 : 0)) >>> 0) } done = Math.max(done, i - 1) }
  return { predict: (i) => { advance(i); return nxt.get(c.revKey(i)) ?? 0 }, observe: () => {} }
}
const GEN_MENU = [0, 1, 2]
const PRED: Record<number, Factory> = { 0: rawP, 1: deltaP, 2: delta2P }
const menuFor = (name: string, arm: Arm): number[] => {
  if (arm === "col") return [0]
  const m = [...GEN_MENU]
  if (arm === "gen") return m
  return [...m, ...Object.keys(SPECIAL[name] ?? {}).map(Number)]
}
const factory = (name: string, id: number): Factory => PRED[id] ?? SPECIAL[name]![id]!
const modOf = (w: number) => 2 ** (8 * w)
const residual = (v: number, p: number, M: number) => { const d = (v - p) % M; return d < 0 ? d + M : d }

// ── (de)serialización de columnas ──────────────────────────────────────────────────────────────
const toPlanes = (vals: number[] | Float64Array, w: number): Uint8Array => {
  const n = vals.length, o = new Uint8Array(n * w)
  for (let k = 0; k < w; k++) { const d = 256 ** k; for (let i = 0; i < n; i++) o[k * n + i] = Math.floor(vals[i]! / d) % 256 }
  return o
}
const toRows = (vals: number[] | Float64Array, w: number): Uint8Array => {
  const n = vals.length, o = new Uint8Array(n * w)
  for (let k = 0; k < w; k++) { const d = 256 ** k; for (let i = 0; i < n; i++) o[i * w + k] = Math.floor(vals[i]! / d) % 256 }
  return o
}
const fromPlanes = (b: Uint8Array, n: number, w: number): number[] => { const o = new Array<number>(n).fill(0); for (let k = w - 1; k >= 0; k--) for (let i = 0; i < n; i++) o[i] = o[i]! * 256 + b[k * n + i]!; return o }
const fromRows = (b: Uint8Array, n: number, w: number): number[] => { const o = new Array<number>(n).fill(0); for (let k = w - 1; k >= 0; k--) for (let i = 0; i < n; i++) o[i] = o[i]! * 256 + b[i * w + k]!; return o }
const planesBytes = (b: Uint8Array, n: number, w: number): Uint8Array => { const o = new Uint8Array(n * w); for (let k = 0; k < w; k++) for (let i = 0; i < n; i++) o[k * n + i] = b[i * w + k]!; return o }   // filas -> planos
const rowsBytes = (b: Uint8Array, n: number, w: number): Uint8Array => { const o = new Uint8Array(n * w); for (let k = 0; k < w; k++) for (let i = 0; i < n; i++) o[i * w + k] = b[k * n + i]!; return o }   // planos -> filas

/** Flujo = método(1) + datos. Método 0 = crudo, 1 = brotli. Elige lo más corto. */
const pack = (data: Uint8Array, q: number): Uint8Array => {
  const c = data.length ? bro(data, q) : data, o = new Uint8Array(1 + Math.min(c.length, data.length))
  if (c.length < data.length) { o[0] = 1; o.set(c, 1); return o }
  o[0] = 0; o.set(data, 1); return o
}
const unpack = (s: Uint8Array): Uint8Array => (s[0] === 1 ? new Uint8Array(zlib.brotliDecompressSync(s.subarray(1))) : s.subarray(1))

// contexto de flujo
const makeCtx = (P: Parsed): Ctx => {
  const n = P.n, fk = new Array<string | undefined>(n), rk = new Array<string | undefined>(n)
  const addr = (i: number, which: "src" | "dst"): string => (P.cls[i]! & C_V4 ? String(P.num[`ip4.${which}`]![i]!) : Buffer.from(P.bytes[`ip6.${which}`]!.subarray(i * 16, i * 16 + 16)).toString("latin1"))
  return {
    n, P,
    flowKey: (i) => (fk[i] ??= `${addr(i, "src")}|${addr(i, "dst")}|${P.num["tcp.sport"]![i]}|${P.num["tcp.dport"]![i]}`),
    revKey: (i) => (rk[i] ??= `${addr(i, "dst")}|${addr(i, "src")}|${P.num["tcp.dport"]![i]}|${P.num["tcp.sport"]![i]}`),
    hdrBytes: () => 0,
  }
}
const rowsOf = (P: Parsed, pres: number): number[] => { const r: number[] = []; for (let i = 0; i < P.n; i++) if (pres === 0 || (P.cls[i]! & pres)) r.push(i); return r }

// ── checksums ──────────────────────────────────────────────────────────────────────────────────
const fold = (a: number) => { while (a > 0xffff) a = (a & 0xffff) + Math.floor(a / 65536); return a }
const sumWords = (b: Uint8Array, s: number, e: number, skip = -1): number => { let a = 0; for (let i = s; i + 1 < e; i += 2) { if (i === skip) continue; a += (b[i]! << 8) | b[i + 1]! } if ((e - s) & 1) a += b[e - 1]! << 8; return a }
/** Posiciones dentro del buffer de paquete: devuelve null si no es calculable. */
export interface PktInfo { start: number; end: number; cls: number; ipOff: number; ipHdr: number; l4Off: number; l4Hdr: number }
const expIp4 = (b: Uint8Array, k: PktInfo): number => (~fold(sumWords(b, k.ipOff, k.ipOff + k.ipHdr, k.ipOff + 10)) & 0xffff)
const expL4 = (b: Uint8Array, k: PktInfo, tcp: boolean): number | null => {
  const isV4 = !!(k.cls & C_V4)
  const segLen = tcp ? (isV4 ? be16(b, k.ipOff + 2) - k.ipHdr : be16(b, k.ipOff + 4)) : be16(b, k.l4Off + 4)
  if (segLen < k.l4Hdr || k.l4Off + segLen > k.end) return null
  let a = isV4 ? sumWords(b, k.ipOff + 12, k.ipOff + 20) : sumWords(b, k.ipOff + 8, k.ipOff + 40)
  a += (tcp ? 6 : 17) + (isV4 ? segLen : (segLen >>> 16) + (segLen & 0xffff))
  a += sumWords(b, k.l4Off, k.l4Off + segLen, k.l4Off + (tcp ? 16 : 6))
  const x = ~fold(a) & 0xffff
  return !tcp && x === 0 ? 0xffff : x
}

// ── codificador ────────────────────────────────────────────────────────────────────────────────
export interface EncStats { arm: Arm; bytes: number; streams: Record<string, number>; packets: number; rawFrac: number; encodeMs: number; selectMs: number; parseMs: number; timeCombined: boolean }

const encodeNum = (P: Parsed, name: string, w: number, rows: number[], arm: Arm, ctx: Ctx, qSel: number, qFin: number): Uint8Array => {
  const vals = rows.map((i) => P.num[name]![i]!), M = modOf(w), menu = menuFor(name, arm)
  let best: { id: number; layout: number; res: number[]; size: number } | null = null
  const resFor = (id: number): number[] => { const pr = factory(name, id)(ctx, M), out = new Array<number>(rows.length); for (let j = 0; j < rows.length; j++) { const i = rows[j]!; out[j] = residual(vals[j]!, pr.predict(i), M); pr.observe(i, vals[j]!) } return out }
  const cands: { id: number; res: number[] }[] = menu.map((id) => ({ id, res: resFor(id) }))
  if (cands.length === 1) { // sin elección de predictor: solo disposición
    for (const layout of [0, 1]) { const s = pack(layout ? toRows(cands[0]!.res, w) : toPlanes(cands[0]!.res, w), qSel).length; if (!best || s < best.size) best = { id: cands[0]!.id, layout, res: cands[0]!.res, size: s } }
  } else for (const c of cands) for (const layout of [0, 1]) { const s = pack(layout ? toRows(c.res, w) : toPlanes(c.res, w), qSel).length; if (!best || s < best.size) best = { id: c.id, layout, res: c.res, size: s } }
  const b = best!, body = pack(b.layout ? toRows(b.res, w) : toPlanes(b.res, w), qFin)
  const o = new Uint8Array(2 + body.length); o[0] = b.id; o[1] = b.layout; o.set(body, 2); return o
}
const encodeBytes = (data: Uint8Array, n: number, w: number, qSel: number, qFin: number): Uint8Array => {
  let best = 0, size = Infinity, pl: Uint8Array | null = null
  for (const layout of [0, 1]) { const d = layout ? data : planesBytes(data, n, w); const s = pack(d, qSel).length; if (s < size) { size = s; best = layout; pl = d } }
  const body = pack(pl!, qFin), o = new Uint8Array(1 + body.length); o[0] = best; o.set(body, 1); return o
}

export const encodePcap = (file: Uint8Array, arm: Arm = "ck", opts: { qSel?: number; qFin?: number } = {}): { out: Uint8Array; stats: EncStats } => {
  const t0 = Date.now(), qSel = opts.qSel ?? 5, qFin = opts.qFin ?? 11
  const P = parsePcap(file), parseMs = Date.now() - t0
  const w = new ByteBuf(), streams: Record<string, number> = {}
  w.u8(0x50); w.u8(ARMS.indexOf(arm))
  if (!P) { w.u8(255); const s = pack(file, qFin); w.push(s, 0, s.length); return { out: w.out().slice(), stats: { arm, bytes: w.n, streams: { fallback: s.length }, packets: 0, rawFrac: 1, encodeMs: Date.now() - t0, selectMs: 0, parseMs, timeCombined: false } } }
  const ctx = makeCtx(P), ts = Date.now()
  // ¿tiempo combinado válido?
  let timeComb = arm === "ctx" || arm === "ck"
  if (timeComb) for (let i = 0; i < P.n; i++) { if (P.num["rec.ts_frac"]![i]! >= P.unit || P.num["rec.ts_sec"]![i]! * P.unit + P.num["rec.ts_frac"]![i]! >= 2 ** 52) { timeComb = false; break } }
  w.u8(0); w.u8((P.le ? 1 : 0) | (P.unit === 1e9 ? 2 : 0) | (timeComb ? 4 : 0) | (P.link === 101 ? 8 : 0)); putVar(w, P.n); w.push(P.globalHdr, 0, 24); putVar(w, P.tail.length); w.push(P.tail, 0, P.tail.length)
  const put = (name: string, s: Uint8Array) => { putVar(w, s.length); w.push(s, 0, s.length); streams[name] = s.length }
  put("cls", pack(P.cls, qFin))
  const ckOn = arm === "ck"
  for (const b of BYTES) put(b.name, encodeBytes(P.bytes[b.name]!, P.n, b.w, qSel, qFin).subarray(0)) // los no presentes son ceros: se codifican completos (costo mínimo con brotli)
  const order = NUM.filter((s) => !(s.name.startsWith("rec.ts")) && !(ckOn && CKCOLS.includes(s.name)))
  for (const s of order) put(s.name, encodeNum(P, s.name, s.w, rowsOf(P, s.pres), arm, ctx, qSel, qFin))
  if (timeComb) {
    const z = new Float64Array(P.n); let prev = 0
    for (let i = 0; i < P.n; i++) { const t = P.num["rec.ts_sec"]![i]! * P.unit + P.num["rec.ts_frac"]![i]!, d = t - prev; z[i] = d >= 0 ? 2 * d : -2 * d - 1; prev = t }
    put("time", pack(toPlanes(z, 7), qFin))
  } else for (const nm of ["rec.ts_sec", "rec.ts_frac"]) put(nm, encodeNum(P, nm, 4, rowsOf(P, 0), arm, ctx, qSel, qFin))
  put("opts4", pack(P.opts4, qFin)); put("optsT", pack(P.optsT, qFin)); put("rawpk", pack(P.rawpk, qFin)); put("payload", pack(P.payload, qFin))
  if (ckOn) {
    // checksums: bandera por paquete aplicable + excepciones (valor guardado) en orden
    const flags: Record<string, number[]> = { "ip4.cksum": [], "tcp.cksum": [], "udp.cksum": [] }, exc: Record<string, number[]> = { "ip4.cksum": [], "tcp.cksum": [], "udp.cksum": [] }
    forEachPacket(file, P, (i, k, buf) => {
      const cl = P.cls[i]!
      if (cl & C_V4) { const e = expIp4(buf, k), v = P.num["ip4.cksum"]![i]!; if (e === v) flags["ip4.cksum"]!.push(1); else { flags["ip4.cksum"]!.push(0); exc["ip4.cksum"]!.push(v) } }
      for (const [nm, bit, tcp] of [["tcp.cksum", C_TCP, true], ["udp.cksum", C_UDP, false]] as const) if (cl & bit) {
        const e = expL4(buf, k, tcp), v = P.num[nm]![i]!
        if (e === null) exc[nm]!.push(v); else if (e === v) flags[nm]!.push(1); else { flags[nm]!.push(0); exc[nm]!.push(v) }
      }
    })
    for (const nm of CKCOLS) { put(`${nm}.flags`, pack(Uint8Array.from(flags[nm]!), qFin)); put(`${nm}.exc`, pack(toPlanes(exc[nm]!, 2), qFin)) }
  }
  const out = w.out().slice()
  return { out, stats: { arm, bytes: out.length, streams, packets: P.n, rawFrac: P.stats.raw / P.n, encodeMs: Date.now() - t0, selectMs: Date.now() - ts, parseMs, timeCombined: timeComb } }
}

/** Recorre los paquetes del archivo original dando posiciones de capas. */
const forEachPacket = (f: Uint8Array, P: Parsed, fn: (i: number, k: PktInfo, buf: Uint8Array) => void) => {
  let q = 24
  for (let i = 0; i < P.n; i++) {
    const incl = P.num["rec.incl"]![i]!, start = q + 16, end = start + incl; q = end
    const cl = P.cls[i]!; let o = start + (cl & C_ETH ? 14 : 0)
    const k: PktInfo = { start, end, cls: cl, ipOff: o, ipHdr: 0, l4Off: 0, l4Hdr: 0 }
    if (cl & C_V4) { k.ipHdr = (P.num["ip4.ver_ihl"]![i]! & 15) * 4; o += k.ipHdr } else if (cl & C_V6) { k.ipHdr = 40; o += 40 }
    k.l4Off = o; k.l4Hdr = cl & C_TCP ? (P.num["tcp.off"]![i]! >> 12) * 4 : cl & C_UDP ? 8 : 0
    fn(i, k, f)
  }
}

// ── decodificador ──────────────────────────────────────────────────────────────────────────────
export const decodePcap = (enc: Uint8Array): Uint8Array => {
  const r = new Rd(enc); if (r.u8() !== 0x50) throw new Error("magic")
  const arm = ARMS[r.u8()]!, mode = r.u8()
  if (mode === 255) return unpack(enc.subarray(r.p))
  const fl = r.u8(), le = !!(fl & 1), unit = fl & 2 ? 1e9 : 1e6, timeComb = !!(fl & 4), link = fl & 8 ? 101 : 1
  const n = r.varint(), globalHdr = r.take(24).slice(), tailLen = r.varint(), tail = r.take(tailLen).slice()
  const P = newParsed(n); P.le = le; P.unit = unit; P.link = link; P.globalHdr = globalHdr; P.tail = tail
  const next = () => { const len = r.varint(); return r.take(len) }
  P.cls.set(unpack(next()))
  for (const b of BYTES) { const s = next(), lay = s[0]!, d = unpack(s.subarray(1)); P.bytes[b.name]!.set(lay ? d : rowsBytes(d, n, b.w)) }
  const ctx = makeCtx(P), ckOn = arm === "ck"
  const order = NUM.filter((s) => !(s.name.startsWith("rec.ts")) && !(ckOn && CKCOLS.includes(s.name)))
  const decNum = (name: string, w: number, rows: number[]) => {
    const s = next(), id = s[0]!, lay = s[1]!, d = unpack(s.subarray(2)), res = lay ? fromRows(d, rows.length, w) : fromPlanes(d, rows.length, w)
    const M = modOf(w), pr = factory(name, id)(ctx, M), col = P.num[name]!
    for (let j = 0; j < rows.length; j++) { const i = rows[j]!; const v = (pr.predict(i) + res[j]!) % M; col[i] = v; pr.observe(i, v) }
  }
  for (const s of order) decNum(s.name, s.w, rowsOf(P, s.pres))
  if (timeComb) {
    const z = fromPlanes(unpack(next()), n, 7); let prev = 0
    for (let i = 0; i < n; i++) { const d = z[i]! % 2 === 0 ? z[i]! / 2 : -(z[i]! + 1) / 2; const t = prev + d; prev = t; const sec = Math.floor(t / unit); P.num["rec.ts_sec"]![i] = sec; P.num["rec.ts_frac"]![i] = t - sec * unit }
  } else for (const nm of ["rec.ts_sec", "rec.ts_frac"]) decNum(nm, 4, rowsOf(P, 0))
  P.opts4 = unpack(next()).slice(); P.optsT = unpack(next()).slice(); P.rawpk = unpack(next()).slice(); P.payload = unpack(next()).slice()
  const ckFlags: Record<string, Uint8Array> = {}, ckExc: Record<string, number[]> = {}
  if (ckOn) for (const nm of CKCOLS) { ckFlags[nm] = unpack(next()).slice(); const eb = unpack(next()); ckExc[nm] = fromPlanes(eb, eb.length / 2, 2) }
  return assemble(P, ckOn, ckFlags, ckExc)
}

/** Reconstruye el archivo completo desde las columnas/flujos decodificados. */
const assemble = (P: Parsed, ckOn: boolean, flags: Record<string, Uint8Array>, exc: Record<string, number[]>): Uint8Array => {
  let total = 24 + P.tail.length
  for (let i = 0; i < P.n; i++) total += 16 + P.num["rec.incl"]![i]!
  const b = new Uint8Array(total); b.set(P.globalHdr, 0)
  let q = 24, pPay = 0, pRaw = 0, p4 = 0, pT = 0
  const fp: Record<string, number> = { "ip4.cksum": 0, "tcp.cksum": 0, "udp.cksum": 0 }, ep: Record<string, number> = { "ip4.cksum": 0, "tcp.cksum": 0, "udp.cksum": 0 }
  const ckValue = (nm: string, expected: number | null): number => {
    if (expected !== null) { if (flags[nm]![fp[nm]!++] === 1) return expected }
    return exc[nm]![ep[nm]!++]!
  }
  for (let i = 0; i < P.n; i++) {
    const incl = P.num["rec.incl"]![i]!, cl = P.cls[i]!
    wr32(b, q, P.num["rec.ts_sec"]![i]!, P.le); wr32(b, q + 4, P.num["rec.ts_frac"]![i]!, P.le); wr32(b, q + 8, incl, P.le); wr32(b, q + 12, P.num["rec.orig"]![i]!, P.le)
    const start = q + 16, end = start + incl; q = end
    let o = start
    if (cl & C_ETH) { b.set(P.bytes["eth.dst"]!.subarray(i * 6, i * 6 + 6), o); b.set(P.bytes["eth.src"]!.subarray(i * 6, i * 6 + 6), o + 6); w16(b, o + 12, P.num["eth.type"]![i]!); o += 14 }
    const k: PktInfo = { start, end, cls: cl, ipOff: o, ipHdr: 0, l4Off: 0, l4Hdr: 0 }
    if (cl & C_V4) {
      const ihl = (P.num["ip4.ver_ihl"]![i]! & 15) * 4; k.ipHdr = ihl
      b[o] = P.num["ip4.ver_ihl"]![i]!; b[o + 1] = P.num["ip4.tos"]![i]!; w16(b, o + 2, P.num["ip4.len"]![i]!); w16(b, o + 4, P.num["ip4.id"]![i]!); w16(b, o + 6, P.num["ip4.frag"]![i]!)
      b[o + 8] = P.num["ip4.ttl"]![i]!; b[o + 9] = P.num["ip4.proto"]![i]!; w32(b, o + 12, P.num["ip4.src"]![i]!); w32(b, o + 16, P.num["ip4.dst"]![i]!)
      b.set(P.opts4.subarray(p4, p4 + ihl - 20), o + 20); p4 += ihl - 20
      w16(b, o + 10, ckOn ? ckValue("ip4.cksum", expIp4(b, k)) : P.num["ip4.cksum"]![i]!)
      o += ihl
    } else if (cl & C_V6) {
      k.ipHdr = 40
      w32(b, o, P.num["ip6.vtf"]![i]!); w16(b, o + 4, P.num["ip6.plen"]![i]!); b[o + 6] = P.num["ip6.nh"]![i]!; b[o + 7] = P.num["ip6.hop"]![i]!
      b.set(P.bytes["ip6.src"]!.subarray(i * 16, i * 16 + 16), o + 8); b.set(P.bytes["ip6.dst"]!.subarray(i * 16, i * 16 + 16), o + 24); o += 40
    }
    k.l4Off = o
    if (cl & C_TCP) {
      const doff = (P.num["tcp.off"]![i]! >> 12) * 4; k.l4Hdr = doff
      w16(b, o, P.num["tcp.sport"]![i]!); w16(b, o + 2, P.num["tcp.dport"]![i]!); w32(b, o + 4, P.num["tcp.seq"]![i]!); w32(b, o + 8, P.num["tcp.ack"]![i]!)
      w16(b, o + 12, P.num["tcp.off"]![i]!); w16(b, o + 14, P.num["tcp.win"]![i]!); w16(b, o + 18, P.num["tcp.urg"]![i]!)
      if (!ckOn) w16(b, o + 16, P.num["tcp.cksum"]![i]!)
      b.set(P.optsT.subarray(pT, pT + doff - 20), o + 20); pT += doff - 20; o += doff
    } else if (cl & C_UDP) {
      k.l4Hdr = 8
      w16(b, o, P.num["udp.sport"]![i]!); w16(b, o + 2, P.num["udp.dport"]![i]!); w16(b, o + 4, P.num["udp.len"]![i]!)
      if (!ckOn) w16(b, o + 6, P.num["udp.cksum"]![i]!)
      o += 8
    }
    if (cl & (C_V4 | C_V6)) { const L = end - o; b.set(P.payload.subarray(pPay, pPay + L), o); pPay += L } else { const L = end - o; b.set(P.rawpk.subarray(pRaw, pRaw + L), o); pRaw += L }
    if (ckOn && (cl & C_TCP)) w16(b, k.l4Off + 16, ckValue("tcp.cksum", expL4(b, k, true)))
    if (ckOn && (cl & C_UDP)) w16(b, k.l4Off + 6, ckValue("udp.cksum", expL4(b, k, false)))
  }
  b.set(P.tail, q)
  return b
}
export const _internal = { parsePcap, ARMS, NUM, BYTES, C_ETH, C_V4, C_V6, C_TCP, C_UDP, expIp4, expL4 }
