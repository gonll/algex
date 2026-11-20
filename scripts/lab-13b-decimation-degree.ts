// Experimento 11 — mecanismo M2: el diezmado por 2^k reduce el GRADO de un polinomio mod 256.
//   p(2^k·i + c) = Σ_m  p^(m)(c)/m! · 2^(k·m) · i^m  ;  2^(k·m) ≡ 0 (mod 256) cuando k·m >= 8  (+ salvo denominadores de m!)
//   => en cada carril el polinomio de grado d tiene grado efectivo <= min(d, ceil(8/k) - 1) (cota heurística; se mide).
// Y la identidad: ⌊(a·i+b)/2^s⌋ + (m·i + e) = ⌊((a + m·2^s)·i + b + e·2^s)/2^s⌋  (Beatty + lineal = Beatty).
import { prng } from "../src/lab/bits"
const r = prng(777)
const mahler = (y: number[], maxD = 40): number => {
  let cur = y.slice()
  for (let D = 0; D <= maxD; D++) {
    let z = true; for (const v of cur) if ((v & 255) !== 0) { z = false; break }
    if (z) return D
    const nx = new Array<number>(cur.length - 1); for (let i = 0; i < nx.length; i++) nx[i] = (cur[i + 1]! - cur[i]!) & 255; cur = nx
  }
  return -1
}
const W = 2048
console.log("Nº de coeficientes de Mahler (mín–máx sobre 30 polinomios enteros aleatorios y todos los carriles c < 2^k), por grado d y diezmado k:")
console.log("d \\ k |   0 |   1 |   2 |   3 |   4 |   5")
for (const d of [2, 3, 4]) {
  const cells: string[] = []
  for (let k = 0; k <= 5; k++) {
    let lo = 99, hi = 0
    for (let t = 0; t < 30; t++) {
      const co = Array.from({ length: d + 1 }, () => r())
      const p = (n: number) => { let acc = 0, pw = 1; for (let m = 0; m <= d; m++) { acc = (acc + Math.imul(co[m]!, pw)) | 0; pw = Math.imul(pw, n) } return acc & 255 }
      for (let c = 0; c < Math.min(1 << k, 8); c++) { const v = mahler(Array.from({ length: W }, (_, i) => p(i * (1 << k) + c))); lo = Math.min(lo, v); hi = Math.max(hi, v) }
    }
    cells.push(`${lo}–${hi}`.padStart(5))
  }
  console.log(`${d}     | ${cells.join(" | ")}`)
}
// identidad Beatty + lineal = Beatty
let ok = true
for (let t = 0; t < 2000 && ok; t++) {
  const a = r(), b = r(), s = r() % 13, m = r() & 255, e = r() & 255
  const A = (a + m * 2 ** s) >>> 0, B = (b + e * 2 ** s) >>> 0
  for (let i = 0; i < 64; i++) {
    const lhs = ((((Math.imul(a, i) + b) >>> 0) >>> s) + Math.imul(m, i) + e) & 255
    const rhs = (((Math.imul(A, i) + B) >>> 0) >>> s) & 255
    if (lhs !== rhs) { ok = false; break }
  }
}
console.log("\nIdentidad Beatty + lineal = Beatty (2000 casos × 64 índices, mod 256):", ok ? "se cumple" : "FALLA")
