"use strict";
// Berlekamp-Massey over GF(2^8): finds the shortest LFSR generating sequence s.
// This solves the Padé [0/L] problem — pure denominator, no numerator polynomial.
//
// In GF(2^8): add = XOR, sub = XOR (char 2), neg(a) = a.
// The algorithm is field-agnostic; only the imported ops change.
// O(n²) time, O(n) space.
//
// Optimized: C, B, T are pre-allocated Uint8Arrays — eliminates array spread
// copies and dynamic growth that caused GC pressure in the previous Array version.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLFSR = exports.berlekampMassey = void 0;
const gf256_1 = require("../utils/gf256");
// Returns LFSR where s[k] = Σ coeffs[i] * s[k-1-i]  for i = 0..length-1
// maxL: abort and return early when L exceeds this — turns O(n²) into O(n·maxL)
//       for incompressible data. Use Infinity to get the exact minimal LFSR.
const berlekampMassey = (s, maxL = Infinity) => {
    if (s.length === 0)
        return { coeffs: [], length: 0 };
    const cap = isFinite(maxL) ? maxL : Math.ceil(s.length / 2);
    const bufSize = cap + 2; // C[0..L], safe upper bound proved by BM invariant
    const C = new Uint8Array(bufSize); // connection polynomial; C[0]=1
    const B = new Uint8Array(bufSize); // snapshot before last L increase
    const T = new Uint8Array(bufSize); // swap buffer
    C[0] = 1;
    B[0] = 1;
    let cLen = 1, bLen = 1; // active polynomial lengths
    let L = 0, m = 1, b = 1;
    for (let n = 0; n < s.length; n++) {
        // discrepancy: d = s[n] ⊕ Σ C[i]·s[n-i]
        let d = s[n];
        for (let i = 1; i <= L; i++)
            d ^= (0, gf256_1.gfMul)(C[i], s[n - i]);
        if (d === 0) {
            m++;
            continue;
        }
        // Save C → T, then update C -= (d/b)·x^m·B
        T.set(C.subarray(0, cLen));
        const tLen = cLen;
        const factor = (0, gf256_1.gfDiv)(d, b);
        const needed = bLen + m;
        if (needed > cLen)
            cLen = needed;
        for (let i = 0; i < bLen; i++)
            C[i + m] ^= (0, gf256_1.gfMul)(factor, B[i]); // ^= = gfSub in GF(2^8)
        if (2 * L <= n) {
            L = n + 1 - L;
            if (L > maxL)
                return { coeffs: [], length: L }; // abort — uncompressible
            B.set(T.subarray(0, tLen));
            bLen = tLen;
            b = d;
            m = 1;
        }
        else {
            m++;
        }
    }
    // C = [1, c₁', ..., cL']; recurrence coeffs = negated tail = tail (neg=id in GF(2^8))
    return { coeffs: Array.from(C.subarray(1, L + 1)), length: L };
};
exports.berlekampMassey = berlekampMassey;
// Extend a sequence to length n by running the LFSR recurrence forward
const runLFSR = (lfsr, init, n) => {
    const out = [...init.slice(0, lfsr.length)];
    for (let i = out.length; i < n; i++) {
        const val = lfsr.coeffs.reduce((acc, c, j) => acc ^ (0, gf256_1.gfMul)(c, out[i - 1 - j]), 0);
        out.push(val);
    }
    return out.slice(0, n);
};
exports.runLFSR = runLFSR;
