"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const berlekamp_massey_1 = require("./berlekamp-massey");
const gf256_1 = require("../utils/gf256");
(0, vitest_1.describe)("berlekampMassey", () => {
    (0, vitest_1.it)("returns length 0 for empty input", () => {
        (0, vitest_1.expect)((0, berlekamp_massey_1.berlekampMassey)([])).toEqual({ coeffs: [], length: 0 });
    });
    (0, vitest_1.it)("finds length-1 LFSR for constant sequence", () => {
        const s = new Array(16).fill(42);
        const lfsr = (0, berlekamp_massey_1.berlekampMassey)(s);
        (0, vitest_1.expect)(lfsr.length).toBe(1);
    });
    (0, vitest_1.it)("finds length-1 LFSR for GF(2^8) geometric sequence", () => {
        // s[n] = 3^n in GF(2^8)
        const s = [1];
        for (let i = 1; i < 32; i++)
            s.push((0, gf256_1.gfMul)(3, s[i - 1]));
        const lfsr = (0, berlekamp_massey_1.berlekampMassey)(s);
        (0, vitest_1.expect)(lfsr.length).toBe(1);
    });
    (0, vitest_1.it)("finds length-2 LFSR for 2-tap GF recurrence", () => {
        // s[n] = 2·s[n-1] ⊕ 3·s[n-2]
        const s = [7, 23];
        for (let i = 2; i < 64; i++)
            s.push((0, gf256_1.gfMul)(2, s[i - 1]) ^ (0, gf256_1.gfMul)(3, s[i - 2]));
        const lfsr = (0, berlekamp_massey_1.berlekampMassey)(s);
        (0, vitest_1.expect)(lfsr.length).toBe(2);
    });
    (0, vitest_1.it)("LFSR length ≈ N/2 for random-looking data", () => {
        // Pseudorandom via xorshift — BM can't do better than L ≈ N/2
        let x = 0x12345678;
        const s = Array.from({ length: 64 }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return x & 0xff;
        });
        const lfsr = (0, berlekamp_massey_1.berlekampMassey)(s);
        (0, vitest_1.expect)(lfsr.length).toBeGreaterThan(8); // no short recurrence
    });
});
(0, vitest_1.describe)("runLFSR", () => {
    (0, vitest_1.it)("extends a geometric sequence correctly", () => {
        const seed = [1];
        const lfsr = (0, berlekamp_massey_1.berlekampMassey)([1, (0, gf256_1.gfMul)(3, 1), (0, gf256_1.gfMul)(3, (0, gf256_1.gfMul)(3, 1))]);
        const out = (0, berlekamp_massey_1.runLFSR)(lfsr, seed, 8);
        const expected = [1];
        for (let i = 1; i < 8; i++)
            expected.push((0, gf256_1.gfMul)(3, expected[i - 1]));
        (0, vitest_1.expect)(out).toEqual(expected);
    });
    (0, vitest_1.it)("roundtrips: BM then runLFSR reproduces original sequence", () => {
        const original = [5, 23];
        for (let i = 2; i < 32; i++)
            original.push((0, gf256_1.gfMul)(7, original[i - 1]) ^ (0, gf256_1.gfMul)(11, original[i - 2]));
        const lfsr = (0, berlekamp_massey_1.berlekampMassey)(original);
        const reproduced = (0, berlekamp_massey_1.runLFSR)(lfsr, original.slice(0, lfsr.length), original.length);
        (0, vitest_1.expect)(reproduced).toEqual(original);
    });
});
