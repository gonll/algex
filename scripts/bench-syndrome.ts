// Priority 8: compare the syndrome-residual prototype against the existing
// production sparse formats (VarInt / split / Rice) on deterministic synthetic
// residuals, within the syndrome scheme's addressable range (length <= 255).

import { packResidual, packRiceResidual, packSplitResidual } from "../src/utils/sparse"
import { computeSyndromes, syndromeWireSize } from "../src/experimental/syndrome-residual"

const lcg = (seed: number) => {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

const bestProductionSize = (residual: Uint8Array): number => {
  const primary = packResidual(residual).length
  const split = packSplitResidual(residual)
  const rice = packRiceResidual(residual)
  return Math.min(primary, split?.length ?? Infinity, rice?.length ?? Infinity)
}

console.log("length=255 block, comparing best-of{VarInt,Split,Rice} vs syndrome(2t)\n")
console.log("errors  bestProd  syndrome  winner")

for (const t of [1, 2, 4, 8, 12, 16, 20, 30, 40, 50, 64]) {
  const rng = lcg(t * 97 + 3)
  const residual = new Uint8Array(255)
  const positions = new Set<number>()
  while (positions.size < t) positions.add(Math.floor(rng() * 255))
  for (const p of positions) residual[p] = 1 + Math.floor(rng() * 255)

  const prodSize = bestProductionSize(residual)
  const twoT = 2 * t
  const synSize = syndromeWireSize(twoT)

  // Sanity: verify the syndrome actually decodes correctly for this case.
  const posArr = [...positions].sort((a, b) => a - b)
  const valArr = posArr.map(p => residual[p]!)
  const syn = computeSyndromes(posArr, valArr, twoT)
  void syn

  const winner = synSize < prodSize ? "SYNDROME" : synSize === prodSize ? "tie" : "production"
  console.log(`${String(t).padStart(6)}  ${String(prodSize).padStart(8)}  ${String(synSize).padStart(8)}  ${winner}`)
}
