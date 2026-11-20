// Experimento 11 — verificación numérica de las afirmaciones matemáticas que explican B11/B12.
//   C1: (n mod 2) = Σ_{k>=1} (-2)^(k-1) C(n,k)  =>  mod 256 tiene 9 coeficientes de Mahler (grado 8).
//   C2: f_j(n) = floor((a n + b) / 2^s) & 255 con j = s - v2(a):  nº mínimo de coeficientes de Mahler mod 256 en función de j.
//   C3 (lema de diezmado): sobre n = 2^k i + c, la secuencia es la misma familia con j' = max(0, j - k).
//   C4: poly∘f_j (P de grado 2 aplicado al byte): nº de coeficientes en función de j.
import { prng } from "../src/lab/bits"

/** Menor D tal que Δ^D f ≡ 0 (mod 256) sobre la ventana; devuelve D (= nº de coeficientes de Mahler), o -1 si > maxD. */
const mahlerCount = (y: number[], maxD = 90): number => {
  let cur = y.slice()
  for (let D = 0; D <= maxD; D++) {
    let z = true; for (const v of cur) if ((v & 255) !== 0) { z = false; break }
    if (z) return D
    const nx = new Array<number>(cur.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = (cur[i + 1]! - cur[i]!) & 255; cur = nx
  }
  return -1
}
const W = 4096
const v2 = (a: number) => (a === 0 ? 32 : 31 - Math.clz32(a & -a))
const beatty = (a: number, b: number, s: number) => (n: number) => ((Math.imul(a, n) + b) >>> 0 >>> s) & 255

// C1
{
  const y = Array.from({ length: W }, (_, n) => n & 1)
  const coef: number[] = []; let cur = y.slice(); for (let k = 0; k < 12; k++) { coef.push(cur[0]! & 255); cur = cur.slice(1).map((v, i) => (v - cur[i]!) & 255) }
  console.log("C1  coeficientes de Mahler de (n mod 2) mod 256:", coef.join(","), " | (-2)^(k-1) mod 256:", [0, ...Array.from({ length: 11 }, (_, i) => ((-2) ** i) & 255)].join(","), "| nº coef =", mahlerCount(y))
}
const rnd = prng(12345)
const oddA = () => (rnd() | 1) >>> 0
console.log("\nC2/C3/C4: nº de coeficientes de Mahler mod 256 (mín/máx sobre 30 instancias aleatorias por celda; -1 = más de 90)")
console.log("j | C2 f_j (k=0) | C3 diezmado k=1 (j'=j-1) | k=2 | k=3 | C4 P(f_j) k=0")
const fmt = (a: number[]) => `${Math.min(...a)}–${Math.max(...a)}`
for (let j = 0; j <= 9; j++) {
  const cols: string[] = []
  for (const k of [0, 1, 2, 3]) {
    const vals: number[] = []
    for (let t = 0; t < 30; t++) {
      const a = (oddA() << 0) >>> 0, b = rnd(), s = j // v2(a)=0 => j = s
      const f = beatty(a, b, s)
      vals.push(mahlerCount(Array.from({ length: W }, (_, i) => f((i << k) + (rnd() & 0 ? 1 : 0)))))   // n = 2^k i
    }
    cols.push(fmt(vals).padStart(9))
  }
  const c4: number[] = []
  for (let t = 0; t < 30; t++) {
    const a = oddA(), b = rnd(), s = j, f = beatty(a, b, s), c0 = rnd(), c1 = rnd(), c2 = rnd() | 1
    c4.push(mahlerCount(Array.from({ length: W }, (_, n) => { const x = f(n); return ((Math.imul(c2, Math.imul(x, x)) + Math.imul(c1, x) + c0) | 0) & 255 })))
  }
  console.log(`${j} | ${cols[0]} | ${cols[1]} | ${cols[2]} | ${cols[3]} | ${fmt(c4).padStart(9)}`)
}
console.log("\nLectura esperada del lema: la columna 'k' del diezmado coincide con la columna k=0 de la fila j-k.")
