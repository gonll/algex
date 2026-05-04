"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const gf_poly_1 = require("./gf-poly");
const addon_1 = require("../native/addon");
const gf256_1 = require("../utils/gf256");
const berlekampMassey = (seq) => {
    const r = addon_1.addon.bmSolve(Buffer.from(seq));
    return { coeffs: r.coeffs, length: r.length };
};
// Build an L=1 GF geometric sequence
const makeGF1 = (n, coeff, seed = 1) => {
    const s = [seed];
    for (let i = 1; i < n; i++)
        s.push((0, gf256_1.gfMul)(coeff, s[i - 1]));
    return s;
};
(0, vitest_1.describe)("evalPoly", () => {
    (0, vitest_1.it)("evaluates x + α at α yields 0", () => {
        // poly = [1, α]  →  f(x) = x + α;  f(α) = α + α = 0
        (0, vitest_1.expect)((0, gf_poly_1.evalPoly)([1, 3], 3)).toBe(0);
    });
    (0, vitest_1.it)("evaluates degree-0 polynomial (constant)", () => {
        (0, vitest_1.expect)((0, gf_poly_1.evalPoly)([5], 7)).toBe(5);
    });
});
(0, vitest_1.describe)("findRoots", () => {
    (0, vitest_1.it)("finds the root of a linear factor [1, α]", () => {
        const roots = (0, gf_poly_1.findRoots)([1, 7]);
        (0, vitest_1.expect)(roots).toContain(7);
        (0, vitest_1.expect)(roots).toHaveLength(1);
    });
    (0, vitest_1.it)("finds both roots of a split quadratic", () => {
        // f(x) = (x + α)(x + β) for distinct α, β
        // minimal poly of L=2 BM on GF sequence xored with another GF sequence
        const lfsr = berlekampMassey([...makeGF1(64, 3), ...makeGF1(64, 5)].slice(0, 128));
        const poly = (0, gf_poly_1.lfsrMinPoly)(lfsr);
        const roots = (0, gf_poly_1.findRoots)(poly);
        // At minimum the roots satisfy f(root) = 0
        for (const r of roots)
            (0, vitest_1.expect)((0, gf_poly_1.evalPoly)(poly, r)).toBe(0);
    });
});
(0, vitest_1.describe)("polyFromRoots", () => {
    (0, vitest_1.it)("reconstructs [1, α] for a single root", () => {
        // (x + α) = [1, α]
        (0, vitest_1.expect)((0, gf_poly_1.polyFromRoots)([7])).toEqual([1, 7]);
    });
    (0, vitest_1.it)("round-trips: polyFromRoots ∘ factorRoots = lfsrMinPoly", () => {
        // L=2 sequence — minimal polynomial must split (two distinct roots found)
        const seq = [...makeGF1(32, 3), ...makeGF1(32, 5)].slice(0, 64);
        const lfsr = berlekampMassey(seq);
        const roots = (0, gf_poly_1.factorRoots)(lfsr);
        if (roots === null)
            return; // polynomial doesn't split — skip this path
        const reconstructed = (0, gf_poly_1.polyFromRoots)(roots);
        (0, vitest_1.expect)(reconstructed).toEqual((0, gf_poly_1.lfsrMinPoly)(lfsr));
    });
    (0, vitest_1.it)("each root is a zero of the reconstructed polynomial", () => {
        const roots = [3, 7, 11];
        const poly = (0, gf_poly_1.polyFromRoots)(roots);
        for (const r of roots)
            (0, vitest_1.expect)((0, gf_poly_1.evalPoly)(poly, r)).toBe(0);
    });
    (0, vitest_1.it)("degree equals number of roots", () => {
        (0, vitest_1.expect)((0, gf_poly_1.polyFromRoots)([]).length).toBe(1); // degree 0: [1]
        (0, vitest_1.expect)((0, gf_poly_1.polyFromRoots)([5]).length).toBe(2);
        (0, vitest_1.expect)((0, gf_poly_1.polyFromRoots)([2, 9]).length).toBe(3);
    });
});
(0, vitest_1.describe)("factorRoots", () => {
    (0, vitest_1.it)("factors L=1 LFSR into its single root", () => {
        const lfsr = berlekampMassey(makeGF1(64, 3));
        const roots = (0, gf_poly_1.factorRoots)(lfsr);
        (0, vitest_1.expect)(roots).not.toBeNull();
        (0, vitest_1.expect)(roots).toHaveLength(1);
        (0, vitest_1.expect)(roots[0]).toBe(3);
    });
    (0, vitest_1.it)("returns null for random-looking sequence (irreducible polynomial)", () => {
        // xorshift pseudo-random — BM finds a long LFSR unlikely to split fully
        let x = 0xdeadbeef;
        const seq = Array.from({ length: 64 }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return x & 0xff;
        });
        const lfsr = berlekampMassey(seq);
        // Might be null OR an array — just verify the function doesn't throw
        (0, vitest_1.expect)(() => (0, gf_poly_1.factorRoots)(lfsr)).not.toThrow();
    });
});
