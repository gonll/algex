import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { makeColumn, planes, fromPlanes, columnBytes, shuffled, pcapColumns, pcapPacketCount, csvColumns, parseCsvLine, jsonColumns } from "./columns"
import { fitPlane, baselines, columnSynthCost, predictorResidual, diagnose } from "./realfit"

const pcap = (pkts: Uint8Array[]): Uint8Array => {
  const parts: number[] = [0xd4, 0xc3, 0xb2, 0xa1, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 1, 0, 0, 0]
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]
  pkts.forEach((d, i) => { parts.push(...u32(1000 + i), ...u32(i * 10), ...u32(d.length), ...u32(d.length), ...d) })
  return Uint8Array.from(parts)
}
const udpPacket = (id: number, sport: number): Uint8Array => {
  const d = new Uint8Array(14 + 20 + 8 + 4)
  d.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0x08, 0x00], 0)
  d[14] = 0x45; d[16] = 0; d[17] = 40; d[18] = id >> 8; d[19] = id & 255; d[22] = 64; d[23] = 17
  d[34] = sport >> 8; d[35] = sport & 255; d[36] = 0; d[37] = 53; d[38] = 0; d[39] = 12
  return d
}

describe("columnas reales y adaptador (exp. 13)", () => {
  it("planos <-> valores y barajado conservan la multiconjunto", () => {
    const vals = Array.from({ length: 100 }, (_, i) => BigInt(1000 + i * 77 + (i % 7)))
    const c = makeColumn("t", "x", vals)!
    expect(c.min).toBe(1000n); expect(c.w).toBe(2)
    expect(fromPlanes(planes(c))).toEqual(c.values)
    expect(columnBytes(c).length).toBe(200)
    const s = shuffled(c, 7); expect([...s.values].sort()).toEqual([...c.values].sort()); expect(s.values).not.toEqual(c.values)
  })
  it("pcap clásico: columnas de registro, Ethernet, IPv4 y UDP", () => {
    const buf = pcap(Array.from({ length: 5 }, (_, i) => udpPacket(100 + i, 5000 + i)))
    expect(pcapPacketCount(buf)).toBe(5)
    const cols = pcapColumns("t", buf)!, by = Object.fromEntries(cols.map((c) => [c.name, c]))
    expect(by["ip.id"]!.values.map(Number)).toEqual([0, 1, 2, 3, 4]); expect(by["ip.id"]!.min).toBe(100n)
    expect(by["udp.sport"]!.n).toBe(5); expect(by["rec.ts_sec"]!.min).toBe(1000n); expect(by["tcp.seq"]).toBeUndefined()
  })
  it("CSV: comillas con comas, decimales escalados, no numéricas descartadas y contadas", () => {
    expect(parseCsvLine('a,"b,c",d', ",")).toEqual(["a", "b,c", "d"])
    const r = csvColumns("t", 'x,y,z,w\n1.5,2,"a,b",\n2.25,3,"c",\n-1,4,"d",\n', ",")
    const x = r.columns.find((c) => c.name === "x")!
    expect(x.min).toBe(-100n)                           // escala 10^2: -1.00 -> -100, 1.50 -> 150, 2.25 -> 225
    expect(r.columns.find((c) => c.name === "y")!.n).toBe(3)
    expect(r.discarded.map((d) => d.name).sort()).toEqual(["w", "z"])
  })
  it("JSON: rutas de índices numéricas en todas las filas", () => {
    const cols = jsonColumns("t", [[[0, 5], "a"], [[7, 9], "b", [1]], [[8, 9], "c"]])
    expect(cols.map((c) => c.name).sort()).toEqual(["json[0][0]", "json[0][1]"])
  })
  it("fitPlane: una rampa lineal módulo 256 se halla y se verifica sobre TODO el plano", () => {
    const n = 3000, y = new Uint8Array(n); for (let i = 0; i < n; i++) y[i] = (7 * i + 3) & 255
    const f = fitPlane(y, [1, 2])
    expect(f.accepted).toBe(true); expect(f.exactFull).toBe(true); expect(f.trained).toBe(2048); expect(f.bits).toBeLessThan(100)
  })
  it("fitPlane: un modelo que solo ajusta el prefijo se detecta como no exacto en el plano completo", () => {
    const n = 3000, y = new Uint8Array(n); for (let i = 0; i < n; i++) y[i] = (7 * i + 3) & 255
    for (let i = 2048; i < n; i++) y[i] ^= 0x55           // la cola rompe la regla
    const f = fitPlane(y, [1])
    expect(f.accepted).toBe(true); expect(f.exactFull).toBe(false)
  })
  it("fitPlane: bytes pseudoaleatorios no se aceptan", () => {
    let s = 12345; const y = new Uint8Array(4096); for (let i = 0; i < y.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; y[i] = (s >>> 16) & 255 }
    expect(fitPlane(y, [1, 2]).accepted).toBe(false)
  })
  it("baselines, costo del sintetizador, predictor+residual y diagnóstico en una columna lineal con ruido", () => {
    const n = 2048, vals = Array.from({ length: n }, (_, i) => BigInt(5000 + 13 * i + ((i * 7919) % 5) - 2))
    const c = makeColumn("t", "y", vals)!, b = baselines(c)
    expect(b.b2).toBeLessThan(b.b0)                       // la diferencia ayuda a una rampa
    const pr = predictorResidual(c)!; expect(pr.kind).toBeTruthy(); expect(pr.bits).toBeLessThan(b.b0)
    expect(diagnose(c).monotone).toBeGreaterThan(0.99)
    const pl = planes(c), fits = pl.map((p) => fitPlane(p, [1]))
    expect(columnSynthCost(c, fits, pl)).toBeGreaterThan(0)
  })
  it("separación ciega: columns.ts y realfit.ts no importan generadores ocultos", () => {
    for (const f of ["./columns.ts", "./realfit.ts"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/hidden-/)
  })
})
