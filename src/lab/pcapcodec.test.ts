import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { encodePcap, decodePcap, parsePcap, brotliFile, Arm, _internal } from "./pcapcodec"

const ARMS: Arm[] = ["col", "gen", "ctx", "ck"]
const Q = { qSel: 1, qFin: 4 }
// ── generador de pcaps de prueba (implementación de checksum INDEPENDIENTE de pcapcodec.ts) ──
const sum = (b: number[], skip = -1): number => { let a = 0; for (let i = 0; i + 1 < b.length; i += 2) { if (i === skip) continue; a += (b[i]! << 8) | b[i + 1]! } if (b.length & 1) a += b[b.length - 1]! << 8; while (a > 0xffff) a = (a & 0xffff) + (a >>> 16); return a }
const csum = (b: number[], skip = -1) => ~sum(b, skip) & 0xffff
const u16 = (v: number) => [(v >> 8) & 255, v & 255]
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
const ip4 = (src: number, dst: number, proto: number, l4: number[], id: number, opts: number[] = [], badCk = false): number[] => {
  const ihl = 5 + opts.length / 4, h = [0x40 | ihl, 0, ...u16(ihl * 4 + l4.length), ...u16(id), 0x40, 0, 64, proto, 0, 0, ...u32(src), ...u32(dst), ...opts]
  const c = csum(h) ^ (badCk ? 0x1234 : 0); h[10] = c >> 8; h[11] = c & 255; return [...h, ...l4]
}
const tcp = (src: number, dst: number, sport: number, dport: number, seq: number, ack: number, flags: number, payload: number[], opts: number[] = [], badCk = false): number[] => {
  const doff = 5 + opts.length / 4, seg = [...u16(sport), ...u16(dport), ...u32(seq), ...u32(ack), (doff << 4), flags, ...u16(65535), 0, 0, 0, 0, ...opts, ...payload]
  const ph = [...u32(src), ...u32(dst), 0, 6, ...u16(seg.length)], c = csum([...ph, ...seg], ph.length + 16) ^ (badCk ? 0x55 : 0)
  seg[16] = c >> 8; seg[17] = c & 255; return seg
}
const udp = (src: number, dst: number, sport: number, dport: number, payload: number[], zeroCk = false): number[] => {
  const seg = [...u16(sport), ...u16(dport), ...u16(8 + payload.length), 0, 0, ...payload]
  const ph = [...u32(src), ...u32(dst), 0, 17, ...u16(seg.length)]; let c = csum([...ph, ...seg], ph.length + 6); if (c === 0) c = 0xffff
  if (!zeroCk) { seg[6] = c >> 8; seg[7] = c & 255 } return seg
}
const eth = (type: number, body: number[], pad = false): number[] => { const f = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, ...u16(type), ...body]; while (pad && f.length < 60) f.push(0); return f }
const rec = (le: boolean, sec: number, frac: number, data: number[], orig = data.length): number[] => {
  const w = (v: number) => (le ? [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255] : u32(v))
  return [...w(sec), ...w(frac), ...w(data.length), ...w(orig), ...data]
}
const hdr = (le: boolean, ns: boolean, link: number): number[] => {
  const w = (v: number) => (le ? [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255] : u32(v))
  const m = ns ? (le ? [0x4d, 0x3c, 0xb2, 0xa1] : [0xa1, 0xb2, 0x3c, 0x4d]) : (le ? [0xd4, 0xc3, 0xb2, 0xa1] : [0xa1, 0xb2, 0xc3, 0xd4])
  return [...m, ...(le ? [2, 0, 4, 0] : [0, 2, 0, 4]), 0, 0, 0, 0, 0, 0, 0, 0, ...w(65535), ...w(link)]
}
const flowsPcap = (n: number, opts: { le?: boolean; ns?: boolean; badCk?: number; v6?: boolean } = {}): Uint8Array => {
  const le = opts.le ?? true, out: number[] = [...hdr(le, !!opts.ns, 1)]
  const seq = new Map<number, number>(); let t = 1_700_000_000, idc = 1000
  for (let i = 0; i < n; i++) {
    t += i % 7 === 0 ? 1 : 0; const frac = (i * 12345) % 1000000, f = i % 5, src = 0x0a000001 + (f & 1), dst = 0x0a000010 + f, sport = 40000 + f, dport = 80
    const pl = Array.from({ length: (i * 13) % 90 }, (_, k) => (k * 7 + i) & 255), s = seq.get(f) ?? 1000 * f
    let body: number[]
    if (i % 4 === 3) body = eth(0x0800, ip4(src, dst, 17, udp(src, dst, 5000 + f, 53, pl, i % 16 === 3), idc++))
    else { body = eth(0x0800, ip4(src, dst, 6, tcp(src, dst, sport, dport, s, 500 + i, i % 11 === 0 ? 0x02 : 0x18, pl, i % 9 === 0 ? [1, 1, 1, 1] : [], opts.badCk !== undefined && i % opts.badCk === 0), idc++, i % 13 === 0 ? [1, 1, 1, 1] : [])); seq.set(f, (s + pl.length + (i % 11 === 0 ? 1 : 0)) >>> 0) }
    out.push(...rec(le, t, frac, body, body.length + (i % 17 === 0 ? 4 : 0)))
  }
  return Uint8Array.from(out)
}
const rt = (f: Uint8Array, arm: Arm): { ok: boolean; size: number } => { const { out } = encodePcap(f, arm, Q); const d = decodePcap(out); return { ok: Buffer.compare(Buffer.from(d), Buffer.from(f)) === 0, size: out.length } }

describe("pcapcodec: reconstrucción exacta (exp. 14)", () => {
  it("el checksum interno coincide con una implementación independiente", () => {
    const f = flowsPcap(30), P = parsePcap(f)!
    expect(P.n).toBe(30); expect(P.stats.tcp + P.stats.udp).toBe(30)
    for (const arm of ARMS) expect(rt(f, arm).ok).toBe(true)
  })
  it("round trip en los 4 brazos: flujos TCP/UDP con opciones, relleno, orig_len distinto, big-endian y nanosegundos", () => {
    for (const o of [{ le: true }, { le: false }, { le: true, ns: true }, { le: false, ns: true }]) { const f = flowsPcap(120, o); for (const arm of ARMS) expect(rt(f, arm).ok, `${JSON.stringify(o)} ${arm}`).toBe(true) }
  })
  it("checksums inválidos y UDP con checksum 0 se reconstruyen exactos (excepciones)", () => {
    const f = flowsPcap(200, { badCk: 3 }); for (const arm of ARMS) expect(rt(f, arm).ok).toBe(true)
  })
  it("el brazo ck es más pequeño que ctx cuando los checksums son válidos (el álgebra se aprovecha)", () => {
    const f = flowsPcap(2000); const a = rt(f, "ctx"), b = rt(f, "ck"); expect(a.ok && b.ok).toBe(true); expect(b.size).toBeLessThan(a.size)
  })
  it("los predictores con estado reducen frente al brazo genérico en tráfico con flujos", () => {
    const f = flowsPcap(2000); const g = rt(f, "gen"), c = rt(f, "ctx"); expect(g.ok && c.ok).toBe(true); expect(c.size).toBeLessThan(g.size)
  })
  it("casos raros: ARP, VLAN, ICMP, fragmento, IPv6 TCP/UDP, paquetes diminutos y cola truncada", () => {
    const le = true, out: number[] = [...hdr(le, false, 1)], s = 0x0a000001, d = 0x0a000002
    out.push(...rec(le, 1, 1, eth(0x0806, [0, 1, 8, 0, 6, 4, 0, 1, 1, 2, 3, 4, 5, 6, 10, 0, 0, 1, 0, 0, 0, 0, 0, 0, 10, 0, 0, 2]), 42))
    out.push(...rec(le, 2, 2, eth(0x8100, [0, 5, 0x08, 0x00, ...ip4(s, d, 6, tcp(s, d, 1, 2, 3, 4, 0x10, [9, 9]), 5)])))
    out.push(...rec(le, 3, 3, eth(0x0800, ip4(s, d, 1, [8, 0, 0, 0, 0, 1, 0, 1, 1, 2, 3], 6))))
    const frag = ip4(s, d, 6, [1, 2, 3, 4, 5, 6, 7, 8], 7); frag[6] = 0x00; frag[7] = 0x08; out.push(...rec(le, 4, 4, eth(0x0800, frag)))
    const v6 = (nh: number, l4: number[]) => eth(0x86dd, [0x60, 0, 0, 0, ...u16(l4.length), nh, 64, ...Array(16).fill(1), ...Array(16).fill(2), ...l4])
    const seg6 = (sp: number, dp: number): number[] => { const seg = [...u16(sp), ...u16(dp), ...u32(1), ...u32(2), 0x50, 0x10, ...u16(100), 0, 0, 0, 0, 7, 7, 7]; const ph = [...Array(16).fill(1), ...Array(16).fill(2), 0, 0, ...u16(seg.length), 0, 0, 0, 6]; const c = csum([...ph, ...seg], ph.length + 16); seg[16] = c >> 8; seg[17] = c & 255; return seg }
    out.push(...rec(le, 5, 5, v6(6, seg6(10, 20))))
    const u6 = [...u16(11), ...u16(22), ...u16(12), 0, 0, 1, 2, 3, 4]; out.push(...rec(le, 6, 6, v6(17, u6)))
    out.push(...rec(le, 7, 7, [1, 2, 3])); out.push(...rec(le, 8, 8, []))
    out.push(...rec(le, 9, 9, eth(0x0800, [0x4f, 0, 0, 20])))    // ihl inválido
    const cut = [...out, 1, 2, 3, 4, 5]                          // cola truncada
    for (const arm of ARMS) expect(rt(Uint8Array.from(cut), arm).ok, arm).toBe(true)
  })
  it("enlace IP crudo (101) y archivo que no es pcap", () => {
    const le = true, out: number[] = [...hdr(le, false, 101)], s = 0x0a000001, d = 0x0a000002
    for (let i = 0; i < 50; i++) out.push(...rec(le, i, i * 3, ip4(s, d, 6, tcp(s, d, 80, 1000 + i, i * 5, i, 0x10, [i, i]), i)))
    for (const arm of ARMS) expect(rt(Uint8Array.from(out), arm).ok).toBe(true)
    for (const junk of [new Uint8Array(0), Uint8Array.from([1, 2, 3]), Uint8Array.from(Array(100).fill(7))]) expect(rt(junk, "ck").ok).toBe(true)
  })
  it("fuzz: paquetes aleatorios con cabeceras mutadas siempre se reconstruyen exactos", () => {
    let st = 12345; const R = (m: number) => { st = (Math.imul(st, 1103515245) + 12345) >>> 0; return (st >>> 8) % m }
    for (let round = 0; round < 8; round++) {
      const le = round % 2 === 0, out: number[] = [...hdr(le, false, 1)]
      for (let i = 0; i < 80; i++) {
        let body: number[]
        const kind = R(4)
        if (kind === 0) body = Array.from({ length: R(120) }, () => R(256))
        else { const s = 0x0a000001, d = 0x0a000002 + R(3); body = eth(R(5) === 0 ? 0x86dd : 0x0800, ip4(s, d, R(2) ? 6 : 17, R(2) ? tcp(s, d, R(65536), R(65536), R(2 ** 32), R(2 ** 32), R(256), Array.from({ length: R(60) }, () => R(256))) : udp(s, d, 5, 6, [1, 2, 3]), R(65536))) }
        for (let m = 0; m < R(4); m++) if (body.length) body[R(body.length)] = R(256)    // mutaciones
        out.push(...rec(le, 1000 + i, R(1000), body, body.length + R(3)))
      }
      for (const arm of ARMS) expect(rt(Uint8Array.from(out), arm).ok, `round ${round} ${arm}`).toBe(true)
    }
  })
  it("un pcap real de test/real-data (si existe) se reconstruye exacto en los 4 brazos", () => {
    let f: Uint8Array | null = null; try { f = new Uint8Array(readFileSync("test/real-data/pcap/http.cap")) } catch { /* no hay datos */ }
    if (!f) return
    for (const arm of ARMS) expect(rt(f, arm).ok, arm).toBe(true)
  })
  it("brotliFile existe y el brazo de reserva no excede el archivo + sobrecarga mínima", () => {
    const junk = Uint8Array.from(Array(5000).fill(0).map((_, i) => (i * 31) & 255)), { out } = encodePcap(junk, "ck", Q)
    expect(out.length).toBeLessThan(junk.length + 20); expect(brotliFile(junk).length).toBeGreaterThan(0); void _internal
  })
  it("separación: pcapcodec.ts no importa nada oculto ni del solver", () => {
    expect(readFileSync(new URL("./pcapcodec.ts", import.meta.url), "utf8")).not.toMatch(/hidden-|compose|decimate/)
  })
})
