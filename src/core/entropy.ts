// Shannon entropy and LFSR compression gating

// Bits per byte; range [0, 8]. Near-8 = random, near-0 = highly structured.
export const shannonEntropy = (bytes: Uint8Array): number => {
  const freq = new Array<number>(256).fill(0)
  for (const b of bytes) freq[b]++
  const n = bytes.length
  return -freq
    .filter((f) => f > 0)
    .reduce((sum, f) => sum + (f / n) * Math.log2(f / n), 0)
}

// True when BM found a short enough LFSR to be worth encoding.
//
// Entropy is intentionally NOT used here: GF(2^8) m-sequences have near-maximum
// Shannon entropy (they cycle through all byte values) yet are algebraically trivial
// (LFSR length = 1). High entropy does NOT imply poor LFSR compressibility.
// The final size gate in the encoder is the authoritative check.
export const isCompressible = (
  bytes: Uint8Array,
  lfsrLength: number,
  ratioThreshold = 0.25
): boolean => lfsrLength / bytes.length <= ratioThreshold
