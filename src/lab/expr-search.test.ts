import { describe, it, expect } from "vitest"
import { searchExpr, evalExpr, exprToString } from "./expr-search"
import { prng } from "./bits"

const gen = (n: number, f: (i: number) => number, mask: number) => Uint8Array.from({ length: n }, (_, i) => f(i) & mask)
const pc = (x: number) => { let c = 0; while (x) { c += x & 1; x >>>= 1 } return c }

describe("expr-search (f(n) de acceso directo)", () => {
  it("halla una afín mod 256 y reproduce TODOS los puntos", () => {
    const t = gen(2048, i => i * 7 + 3, 255)
    const r = searchExpr(t, "byte")!
    expect(r).not.toBeNull()
    for (let i = 0; i < t.length; i++) expect(evalExpr(r.expr, i) & 255).toBe(t[i])
  })
  it("halla Thue–Morse (bit) con pocos nodos", () => {
    const t = gen(4096, i => pc(i) & 1, 1)
    const r = searchExpr(t, "bit")!
    expect(r).not.toBeNull()
    expect(r.costBits).toBeLessThan(64)
    expect(exprToString(r.expr)).toContain("pc")
  })
  it("constante libre en la raíz: (n*n) % 251", () => {
    const t = gen(2048, i => (i * i) % 251, 255)
    const r = searchExpr(t, "byte")!
    expect(r).not.toBeNull()
    for (let i = 0; i < t.length; i++) expect(evalExpr(r.expr, i) & 255).toBe(t[i])
  })
  it("controles negativos: aleatorio no tiene expresión corta (sin falsos positivos)", () => {
    const r = prng(5), t = Uint8Array.from({ length: 2048 }, () => r() & 255)
    expect(searchExpr(t, "byte", { maxSize: 5 })).toBeNull()
    const b = Uint8Array.from({ length: 4096 }, () => r() & 1)
    expect(searchExpr(b, "bit", { maxSize: 5 })).toBeNull()
  })
})
