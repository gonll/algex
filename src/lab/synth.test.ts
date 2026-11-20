import { describe, it, expect } from "vitest"
import * as fs from "fs"
import { solveGf2Affine, solvePolyMod256, solveBeatty, solveAnf, discover } from "./synth"
import { prng } from "./bits"

const N = 1 << 16
const gen = (f: (n: number) => number) => Uint8Array.from({ length: N }, (_, n) => f(n) & 255)

describe("synth (solvers analíticos)", () => {
  it("GF(2) afín: xorshift con constante", () => {
    const f = (n: number) => { let x = n >>> 0; x = (x ^ (x << 3)) >>> 0; x = (x ^ (x >>> 5)) >>> 0; return (x ^ 0x5a) & 255 }
    const r = solveGf2Affine(gen(f)).rep!
    expect(r).not.toBeNull()
    for (const n of [0, 1, 777, 65535, 70000, 999999]) expect(r.eval(n)).toBe(f(n) & 255)
  })
  it("polinomio mod 256 con coeficientes grandes y extrapolación", () => {
    const f = (n: number) => (Math.imul(123456789, Math.imul(n, Math.imul(n, n))) + Math.imul(987654321, Math.imul(n, n)) + Math.imul(55555, n) + 77) | 0
    const r = solvePolyMod256(gen(f)).rep!
    expect(r).not.toBeNull()
    r.prepare!(1 << 20)
    for (const n of [0, 5, 65536, 70001, 1000000]) expect(r.eval(n)).toBe(f(n) & 255)
  })
  it("afín desplazada: recupera a, b, s con constantes de 32 bits y extrapolación", () => {
    for (const [a, b, s] of [[0x9e3779b1, 0x12345678, 13], [0xdeadbeef, 0x0badf00d, 24], [0x0001234f, 0x77, 0], [0x7fffffff, 0xfffffff0, 7]] as const) {
      const f = (n: number) => (((Math.imul(a, n) + b) >>> 0) >>> s) & 255
      const r = solveBeatty(gen(f)).rep!
      expect(r, `a=${a} s=${s}`).not.toBeNull()
      for (const n of [65536, 65537, 100000, 1000000]) expect(r.eval(n)).toBe(f(n))
    }
  })
  it("ANF: booleana cuadrática dispersa", () => {
    const f = (n: number) => ((n & 1) ^ ((n >>> 3) & (n >>> 7) & 1)) | ((((n >>> 2) ^ (n >>> 9)) & 1) << 1)
    const r = solveAnf(gen(f)).rep!
    expect(r).not.toBeNull()
    for (const n of [0, 12345, 65535]) expect(r.eval(n)).toBe(f(n) & 255)
  })
  it("XOR-delta + GF(2): prefijo-XOR de una lineal", () => {
    const g = (n: number) => { let x = n >>> 0; x = (x ^ (x << 2)) >>> 0; x = (x ^ (x >>> 4)) >>> 0; return x & 255 }
    const y = new Uint8Array(N); let acc = 0; for (let n = 0; n < N; n++) { acc ^= g(n); y[n] = acc }
    const d = discover(y)
    expect(d.rep).not.toBeNull()
    expect(d.transform).toBe("xor-delta")
    d.rep!.prepare!(1 << 18)
    for (const n of [N, N + 17, 200000]) { let a = 0; for (let i = 0; i <= n; i++) a ^= g(i); expect(d.rep!.eval(n)).toBe(a & 255) }
  })
  it("controles negativos: aleatorio y hash no producen representación", () => {
    const r = prng(42)
    expect(discover(Uint8Array.from({ length: N }, () => r() & 255)).rep).toBeNull()
    const h = (n: number) => { let x = n >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return x & 255 }
    expect(discover(gen(h)).rep).toBeNull()
  })
  it("separación ciega: el buscador no importa los generadores ocultos", () => {
    for (const f of ["src/lab/synth.ts", "src/lab/expr-search.ts"]) expect(fs.readFileSync(f, "utf8")).not.toMatch(/hidden-gen/)
  })
})
