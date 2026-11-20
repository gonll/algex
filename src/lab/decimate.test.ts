import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { Node, evalVec, costBits, simplify } from "./ast"
import { lane, laneLen, shareLanes, encodeField, decodeField, walk } from "./decimate"
import { discoverCompose } from "./compose"

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

describe("diezmado: carriles y compartición de parámetros (exp. 12-2)", () => {
  it("carriles: y_c(i) = y(m i + c), longitud potencia de 2", () => {
    const y = Uint8Array.from({ length: 65536 }, (_, i) => i & 255)
    expect(laneLen(65536, 3)).toBe(16384); expect(laneLen(65536, 16)).toBe(4096); expect(laneLen(65536, 5)).toBe(8192)
    const l = lane(y, 5, 2, 8192); expect(l[7]).toBe(y[5 * 7 + 2])
  })
  it("walk es una biyección sobre los campos: f=id reproduce el nodo y costBits no cambia", () => {
    const n: Node = { t: "xorc", k: 9, x: { t: "baff", rows: [1, 2, 4, 8, 16, 32, 64, 128], k: 3, x: { t: "beatty", a: 12345, b: 678, s: 5 } } }
    expect(walk(n, (_w, v) => v)).toEqual(n)
  })
  it("encodeField: const, poly-en-c, gf2-en-c y crudo son reversibles", () => {
    const m = 8, w = 8
    const cases: number[][] = [
      Array(m).fill(77),
      Array.from({ length: m }, (_, c) => (5 + 3 * c + 7 * c * (c - 1) / 2) & 255),     // grado 2 en c
      Array.from({ length: m }, (_, c) => 0xa5 ^ ((c & 1) * 0x11) ^ (((c >> 1) & 1) * 0x42) ^ (((c >> 2) & 1) * 0x07)),
      [3, 200, 17, 99, 250, 1, 77, 128],
    ]
    const kinds = cases.map((v) => { const e = encodeField(v, w); for (let c = 0; c < m; c++) expect(decodeField(e, c, w)).toBe(v[c]); return e.enc.kind })
    expect(kinds[0]).toBe("const"); expect(kinds[1]).toBe("polyc"); expect(kinds[2]).toBe("gf2c"); expect(kinds[3]).toBe("raw")
  })
  it("encodeField con anchos de 32 bits (Beatty) y m no potencia de 2", () => {
    const m = 5, w = 32, v = Array.from({ length: m }, (_, c) => (Math.imul(0x9e3779b1, c) + 12345) >>> 0)
    const e = encodeField(v, w); for (let c = 0; c < m; c++) expect(decodeField(e, c, w)).toBe(v[c])
    expect(e.enc.kind).toBe("polyc")   // lineal en c módulo 2^32
  })
  it("shareLanes: lanes de poly con coeficientes polinómicos en c comparten y reconstruyen igual", () => {
    const m = 8, L = 64
    const nodes: Node[] = Array.from({ length: m }, (_, c) => ({ t: "poly", coef: [(10 + c) & 255, (3 * c) & 255, 5] }))
    const s = shareLanes(nodes)
    expect(s.shared).toBe(true); expect(s.bits).toBeLessThan(s.independentBits)
    for (let c = 0; c < m; c++) expect(same(evalVec(s.rebuild(c), L), evalVec(nodes[c]!, L))).toBe(true)
  })
  it("shareLanes: formas distintas -> sin compartir, costo = suma de carriles + cabecera", () => {
    const nodes: Node[] = [{ t: "poly", coef: [1, 2] }, { t: "beatty", a: 3, b: 4, s: 2 }]
    const s = shareLanes(nodes); expect(s.shared).toBe(false)
    expect(s.bits).toBe(costBits(nodes[0]!) + costBits(nodes[1]!) + 3)
  })
  it("extremo a extremo: Beatty diezmada por 4 -> carriles resueltos por el solver, compartidos y reconstruibles", () => {
    const N = 1 << 14, a = 0x9e3779b1 | 0, b = 54321, s = 9
    const y = new Uint8Array(N); for (let n = 0; n < N; n++) y[n] = (((Math.imul(a, n) + b) >>> 0) >>> s) & 255
    const m = 4, L = laneLen(N, m), lanes: Node[] = []
    for (let c = 0; c < m; c++) { const r = discoverCompose(lane(y, m, c, L), { maxDepth: 1, work: 2e8 }); expect(r).not.toBeNull(); lanes.push(simplify(r!.node)) }
    const sh = shareLanes(lanes)
    for (let c = 0; c < m; c++) expect(same(evalVec(sh.rebuild(c), L), lane(y, m, c, L))).toBe(true)
  })
  it("separación ciega: decimate.ts no importa generadores ocultos", () => {
    const src = readFileSync(new URL("./decimate.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/hidden-/)
  })
})
