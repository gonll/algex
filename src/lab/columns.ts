// Extracción mecánica de columnas numéricas de datos reales (exp. 13). No conoce el solver ni los generadores ocultos.
// Reglas: ver docs/research/prereg-real.md. Una columna = secuencia de n valores enteros sin signo (tras restar el mínimo).

export interface Column { src: string; name: string; n: number; w: number; min: bigint; values: bigint[] }
export const MIN_N = 2048

const bytesFor = (range: bigint): number => { let w = 1; while (w < 8 && range >= 1n << BigInt(8 * w)) w++; return w }
export const makeColumn = (src: string, name: string, vals: bigint[]): Column | null => {
  if (vals.length === 0) return null
  let mn = vals[0]!, mx = vals[0]!
  for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v }
  const w = bytesFor(mx - mn)
  return { src, name, n: vals.length, w, min: mn, values: vals.map((v) => v - mn) }
}
/** w planos de bytes, LSB primero, de la columna (valores - mínimo). */
export const planes = (c: Column): Uint8Array[] => {
  const out = Array.from({ length: c.w }, () => new Uint8Array(c.n))
  for (let i = 0; i < c.n; i++) { let v = c.values[i]!; for (let p = 0; p < c.w; p++) { out[p]![i] = Number(v & 255n); v >>= 8n } }
  return out
}
/** Bytes de la columna, valores contiguos little-endian. */
export const columnBytes = (c: Column): Uint8Array => {
  const out = new Uint8Array(c.n * c.w)
  for (let i = 0; i < c.n; i++) { let v = c.values[i]!; for (let p = 0; p < c.w; p++) { out[i * c.w + p] = Number(v & 255n); v >>= 8n } }
  return out
}
export const fromPlanes = (pl: Uint8Array[]): bigint[] => {
  const n = pl[0]!.length, out: bigint[] = new Array(n)
  for (let i = 0; i < n; i++) { let v = 0n; for (let p = pl.length - 1; p >= 0; p--) v = (v << 8n) | BigInt(pl[p]![i]!); out[i] = v }
  return out
}
/** Permutación determinista (barajado de filas) para el control negativo. */
export const shuffled = (c: Column, seed: number): Column => {
  let s = (seed >>> 0) || 1
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s }
  const v = c.values.slice()
  for (let i = v.length - 1; i > 0; i--) { const j = r() % (i + 1); const t = v[i]!; v[i] = v[j]!; v[j] = t }
  return { ...c, name: c.name + " [barajada]", values: v }
}

// ── PCAP clásico ───────────────────────────────────────────────────────────────────────────────
type Field = [layer: string, name: string, off: number, size: number]
const ETH: Field[] = [["eth", "dst", 0, 6], ["eth", "src", 6, 6], ["eth", "type", 12, 2]]
const IP4: Field[] = [["ip", "ver_ihl", 0, 1], ["ip", "tos", 1, 1], ["ip", "len", 2, 2], ["ip", "id", 4, 2], ["ip", "flags_frag", 6, 2], ["ip", "ttl", 8, 1], ["ip", "proto", 9, 1], ["ip", "cksum", 10, 2], ["ip", "src", 12, 4], ["ip", "dst", 16, 4]]
const TCP: Field[] = [["tcp", "sport", 0, 2], ["tcp", "dport", 2, 2], ["tcp", "seq", 4, 4], ["tcp", "ack", 8, 4], ["tcp", "off_flags", 12, 2], ["tcp", "win", 14, 2], ["tcp", "cksum", 16, 2], ["tcp", "urg", 18, 2]]
const UDP: Field[] = [["udp", "sport", 0, 2], ["udp", "dport", 2, 2], ["udp", "len", 4, 2], ["udp", "cksum", 6, 2]]
const ICMP: Field[] = [["icmp", "type", 0, 1], ["icmp", "code", 1, 1], ["icmp", "cksum", 2, 2]]
const be = (b: Uint8Array, o: number, s: number): bigint => { let v = 0n; for (let i = 0; i < s; i++) v = (v << 8n) | BigInt(b[o + i]!); return v }

export const pcapPacketCount = (buf: Uint8Array): number => {
  if (buf.length < 24) return 0
  const le = buf[0] === 0xd4 && buf[1] === 0xc3, magicOk = (buf[0] === 0xd4 && buf[1] === 0xc3 && buf[2] === 0xb2 && buf[3] === 0xa1) || (buf[0] === 0xa1 && buf[1] === 0xb2 && buf[2] === 0xc3 && buf[3] === 0xd4)
  if (!magicOk) return -1
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let p = 24, n = 0
  while (p + 16 <= buf.length) { const incl = dv.getUint32(p + 8, le); if (p + 16 + incl > buf.length) break; p += 16 + incl; n++ }
  return n
}
/** Todas las columnas de campos de cabecera de longitud fija (registro pcap, Ethernet, IPv4, TCP/UDP/ICMP). null si no es pcap clásico Ethernet. */
export const pcapColumns = (src: string, buf: Uint8Array): Column[] | null => {
  if (buf.length < 24) return null
  const m0 = (buf[0]! << 24 | buf[1]! << 16 | buf[2]! << 8 | buf[3]!) >>> 0
  const le = m0 === 0xd4c3b2a1; if (!le && m0 !== 0xa1b2c3d4) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(20, le) !== 1) return null            // solo enlace Ethernet
  const cols = new Map<string, bigint[]>(); const add = (k: string, v: bigint) => { let a = cols.get(k); if (!a) { a = []; cols.set(k, a) } a.push(v) }
  let p = 24
  while (p + 16 <= buf.length) {
    const incl = dv.getUint32(p + 8, le); if (p + 16 + incl > buf.length) break
    add("rec.ts_sec", BigInt(dv.getUint32(p, le))); add("rec.ts_usec", BigInt(dv.getUint32(p + 4, le))); add("rec.caplen", BigInt(incl)); add("rec.origlen", BigInt(dv.getUint32(p + 12, le)))
    const d = buf.subarray(p + 16, p + 16 + incl)
    const take = (fs: Field[], base: number) => { for (const [l, n, o, s] of fs) add(`${l}.${n}`, be(d, base + o, s)) }
    if (d.length >= 14) {
      take(ETH, 0)
      const et = Number(be(d, 12, 2))
      if (et === 0x0800 && d.length >= 34 && (d[14]! >> 4) === 4) {
        take(IP4, 14)
        const ihl = (d[14]! & 15) * 4, base = 14 + ihl, proto = d[23]!, frag = Number(be(d, 20, 2)) & 0x1fff
        if (ihl >= 20 && frag === 0) {
          if (proto === 6 && d.length >= base + 20) take(TCP, base)
          else if (proto === 17 && d.length >= base + 8) take(UDP, base)
          else if (proto === 1 && d.length >= base + 4) take(ICMP, base)
        }
      }
    }
    p += 16 + incl
  }
  const out: Column[] = []; for (const [k, v] of cols) { const c = makeColumn(src, k, v); if (c) out.push(c) }
  return out
}

// ── CSV ────────────────────────────────────────────────────────────────────────────────────────
export const parseCsvLine = (line: string, delim: string): string[] => {
  const out: string[] = []; let cur = "", q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else if (ch === '"') q = true
    else if (ch === delim) { out.push(cur); cur = "" }
    else cur += ch
  }
  out.push(cur); return out
}
export interface CsvReport { columns: Column[]; discarded: { name: string; reason: string }[] }
/** Toda columna cuyas celdas no vacías sean todas numéricas. Decimales (≤ 6) → entero escalado por 10^d; si no, se descarta y se cuenta. Celdas vacías se omiten. */
export const csvColumns = (src: string, text: string, delim: string, maxRows = Infinity, missing?: string): CsvReport => {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0]!, delim), rows = lines.slice(1, 1 + maxRows).map((l) => parseCsvLine(l, delim))
  const columns: Column[] = [], discarded: { name: string; reason: string }[] = []
  header.forEach((name, j) => {
    const cells = rows.map((r) => (r[j] ?? "").trim()).filter((s) => s !== "" && s !== missing)
    if (cells.length === 0) { discarded.push({ name, reason: "vacía" }); return }
    if (!cells.every((s) => /^-?\d+(\.\d+)?$/.test(s))) { discarded.push({ name, reason: "no numérica" }); return }
    const d = Math.max(...cells.map((s) => (s.includes(".") ? s.length - s.indexOf(".") - 1 : 0)))
    if (d > 6) { discarded.push({ name, reason: `${d} decimales` }); return }
    const vals = cells.map((s) => {
      const neg = s.startsWith("-"), t = neg ? s.slice(1) : s, [ip, fp = ""] = t.split(".")
      const v = BigInt(ip! + fp.padEnd(d, "0")); return neg ? -v : v
    })
    const c = makeColumn(src, name, vals); if (c) columns.push(c)
  })
  return { columns, discarded }
}

// ── JSON ───────────────────────────────────────────────────────────────────────────────────────
/** Rutas de índices que alcanzan un número en TODAS las filas de un array de filas. Cada ruta = una columna. */
export const jsonColumns = (src: string, rows: unknown[]): Column[] => {
  const paths = new Map<string, bigint[]>()
  const walkJ = (x: unknown, path: string, acc: Map<string, bigint>) => {
    if (typeof x === "number" && Number.isInteger(x)) acc.set(path, BigInt(x))
    else if (Array.isArray(x)) x.forEach((e, i) => walkJ(e, `${path}[${i}]`, acc))
  }
  const per = rows.map((r) => { const m = new Map<string, bigint>(); walkJ(r, "", m); return m })
  for (const k of per[0]?.keys() ?? []) if (per.every((m) => m.has(k))) paths.set(k, per.map((m) => m.get(k)!))
  const out: Column[] = []; for (const [k, v] of paths) { const c = makeColumn(src, `json${k}`, v); if (c) out.push(c) }
  return out
}
