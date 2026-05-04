"use strict";
// Shannon entropy and LFSR compression gating
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCompressible = exports.shannonEntropy = void 0;
// Bits per byte; range [0, 8]. Near-8 = random, near-0 = highly structured.
const shannonEntropy = (bytes) => {
    const freq = new Array(256).fill(0);
    for (const b of bytes)
        freq[b]++;
    const n = bytes.length;
    return -freq
        .filter((f) => f > 0)
        .reduce((sum, f) => sum + (f / n) * Math.log2(f / n), 0);
};
exports.shannonEntropy = shannonEntropy;
// True when BM found a short enough LFSR to be worth encoding.
//
// Entropy is intentionally NOT used here: GF(2^8) m-sequences have near-maximum
// Shannon entropy (they cycle through all byte values) yet are algebraically trivial
// (LFSR length = 1). High entropy does NOT imply poor LFSR compressibility.
// The final size gate in the encoder is the authoritative check.
const isCompressible = (bytes, lfsrLength, ratioThreshold = 0.25) => lfsrLength / bytes.length <= ratioThreshold;
exports.isCompressible = isCompressible;
