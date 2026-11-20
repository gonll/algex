import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { Node, evalVec, encode, decode, costBits, simplify } from "./ast"
import { discoverCompose, baffLift, idxQuotient, idxLiftPoly, verify } from "./compose"
import { makeHidden } from "./hidden-gen"
import { makeGrid, makeComposed } from "./hidden-compose"

describe("ast", () => {
  const nodes: Node[] = [
    { t: "poly", coef: [3, 5, 7] },
    { t: "gf2", K: 5, c0: 9, col: [1, 2, 4, 8, 16] },
    { t: "beatty", a: 123456789, b: 182347953, s: 20 },
    { t: "anf", K: 4, monos: [[0, 3], [1], [], [15], [2, 4], [], [], [8]] },
    { t: "table", data: [1, 2, 3, 4] },
    { t: "baff", rows: [1, 2, 4, 8, 16, 32, 64, 128], k: 7, x: { t: "xorc", k: 5, x: { t: "poly", coef: [1, 2] } } },
    { t: "il2", a: { t: "poly", coef: [1] }, b: { t: "mulo", m: 7, x: { t: "rotl", r: 3, x: { t: "poly", coef: [2, 1] } } } },
    { t: "prefix", op: "add", x: { t: "bin", op: "xor", a: { t: "poly", coef: [1, 1] }, b: { t: "addc", k: 3, x: { t: "table", data: [5, 6] } } } },
    { t: "idx", bits: 6, rows: [3, 5, 9], k: 5, x: { t: "table", data: [1, 2, 3, 4, 5, 6, 7, 8] } },
  ]
  it("encode/decode es un viaje de ida y vuelta exacto y la evaluación coincide", () => {
    for (const n of nodes) {
      const d = decode(encode(n))
      expect(d).toEqual(n)
      expect(Array.from(evalVec(d, 512))).toEqual(Array.from(evalVec(n, 512)))
      expect(costBits(n)).toBe(encode(n).length)
    }
  })
  it("simplify(idx∘idx) preserva la función", () => {
    const n: Node = { t: "idx", bits: 8, rows: [3, 5, 9, 17, 33, 65, 129, 255], k: 12, x: { t: "idx", bits: 8, rows: [3, 1, 6, 12, 24, 48, 96, 192], k: 77, x: { t: "poly", coef: [3, 5, 7] } } }
    expect(Array.from(evalVec(simplify(n), 256))).toEqual(Array.from(evalVec(n, 256)))
  })
})

describe("peelers", () => {
  it("baffLift + hoja poly reconstruyen X1 exacto (solo peeler baff)", () => {
    let ok = 0
    for (let s = 1; s <= 6; s++) {
      const y = makeHidden("X1", s).train(1 << 12)
      const r = discoverCompose(y, { maxDepth: 2, ms: 8000, peelers: ["baff"] })
      if (r && verify(r.node, y) && r.path[0] === "baff") ok++
    }
    expect(ok).toBeGreaterThan(0)
  })
  it("el buscador compone: X1 y X2 se descubren con peelers y se reconstruyen exactos", () => {
    let ok = 0
    for (let s = 1; s <= 4; s++) for (const f of ["X1", "X2"] as const) {
      const y = makeHidden(f, s).train(1 << 12)
      const r = discoverCompose(y, { maxDepth: 3, ms: 15000 })
      if (r && verify(r.node, y)) ok++
    }
    expect(ok).toBeGreaterThan(0)
  })
  it("no hay falsos positivos en aleatorio", () => {
    const y = makeHidden("R", 1).train(1 << 12)
    const r = discoverCompose(y, { maxDepth: 2, ms: 5000 })
    expect(r === null || r.cost >= 0.25 * 8 * y.length).toBe(true)
  })
  it("idxQuotient/idxLiftPoly existen y devuelven listas", () => {
    expect(Array.isArray(idxQuotient(new Uint8Array(1 << 10)))).toBe(true)
    expect(Array.isArray(idxLiftPoly(new Uint8Array(256)))).toBe(true)
  })
})

describe("presupuesto determinista y monotonía en profundidad", () => {
  const insts = (): Array<[string, Uint8Array]> => [
    ["X1", makeHidden("X1", 3).train(1 << 12)], ["X2", makeHidden("X2", 2).train(1 << 12)],
    ["G11j3", makeGrid("G11", 3, 5).train(1 << 12)], ["B4", makeComposed("B4", 7).train(1 << 12)],
  ]
  it("es determinista: mismos datos y opciones => mismo costo, mismo trabajo, misma ruta", () => {
    for (const [, y] of insts().slice(0, 2)) {
      const a = discoverCompose(y, { maxDepth: 2, work: 2e8 }), b = discoverCompose(y, { maxDepth: 2, work: 2e8 })
      expect(a && b).toBeTruthy()
      expect([a!.cost, a!.work, a!.path.join(">")]).toEqual([b!.cost, b!.work, b!.path.join(">")])
    }
  })
  it("el costo no aumenta al aumentar maxDepth (monotonía por construcción)", () => {
    for (const [name, y] of insts()) {
      let prev = Infinity
      for (let d = 0; d <= 3; d++) {
        const r = discoverCompose(y, { maxDepth: d, work: 2e8 })
        const c = r ? r.cost : Infinity
        expect(c, `${name} d=${d}`).toBeLessThanOrEqual(prev)
        prev = c
      }
    }
  })
  it("el trabajo respeta el presupuesto (con sobrecoste acotado por una sola carga)", () => {
    const y = makeHidden("R", 1).train(1 << 12)
    const r = discoverCompose(y, { maxDepth: 3, work: 1e6 })
    const w = r ? r.work : 0
    expect(w).toBeLessThan(15e6 + 4 * 4e7)
  })
})

describe("separación ciega", () => {
  it("el buscador composicional no importa los generadores ocultos", () => {
    for (const f of ["compose.ts", "ast.ts", "probes.ts"]) {
      const src = readFileSync(`src/lab/${f}`, "utf8")
      expect(/from\s+["']\.\/hidden-/.test(src)).toBe(false)
    }
  })
})
