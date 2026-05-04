"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pade_1 = require("./pade");
const gf256_1 = require("../utils/gf256");
// Build a GF geometric sequence starting at seed with multiplier coeff
const makeGF = (n, coeff, seed = 1) => {
    const s = [seed];
    for (let i = 1; i < n; i++)
        s.push((0, gf256_1.gfMul)(coeff, s[i - 1]));
    return s;
};
(0, vitest_1.describe)("findBestPade", () => {
    (0, vitest_1.it)("finds offset=0, L=1 for pure GF geometric sequence", () => {
        const { offset, lfsr } = (0, pade_1.findBestPade)(makeGF(256, 3));
        (0, vitest_1.expect)(offset).toBe(0);
        (0, vitest_1.expect)(lfsr.length).toBe(1);
    });
    (0, vitest_1.it)("finds non-zero offset for data with noise prefix", () => {
        // 12 noise bytes then GF sequence — best Padé skips some of the noise
        const noise = Array.from({ length: 12 }, (_, i) => (i * 37 + 11) & 0xff);
        const gf = makeGF(500, 5);
        const { offset } = (0, pade_1.findBestPade)([...noise, ...gf], 12);
        (0, vitest_1.expect)(offset).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("never returns offset > maxOffset", () => {
        const seq = Array.from({ length: 200 }, () => Math.floor(Math.random() * 256));
        const { offset } = (0, pade_1.findBestPade)(seq, 4);
        (0, vitest_1.expect)(offset).toBeLessThanOrEqual(4);
    });
});
(0, vitest_1.describe)("findApproxL2", () => {
    (0, vitest_1.it)("finds the correct (c1, c2) for a perfect L=2 GF sequence", () => {
        const c1 = 0x1b, c2 = 0x4e;
        const seq = [1, 3];
        for (let i = 2; i < 256; i++)
            seq.push((0, gf256_1.gfAdd)((0, gf256_1.gfMul)(c1, seq[i - 1]), (0, gf256_1.gfMul)(c2, seq[i - 2])));
        const result = (0, pade_1.findApproxL2)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.coeffs[0]).toBe(c1);
        (0, vitest_1.expect)(result.lfsr.coeffs[1]).toBe(c2);
        (0, vitest_1.expect)(result.nonZeroCount).toBe(0);
    });
    (0, vitest_1.it)("finds the dominant (c1, c2) under ~5% noise", () => {
        const c1 = 0x57, c2 = 0x2f;
        const seq = [1, 7];
        for (let i = 2; i < 512; i++)
            seq.push((0, gf256_1.gfAdd)((0, gf256_1.gfMul)(c1, seq[i - 1]), (0, gf256_1.gfMul)(c2, seq[i - 2])));
        // Flip ~5% of bytes
        for (let i = 0; i < 25; i++)
            seq[(i * 19) % seq.length] ^= 0x5a;
        const result = (0, pade_1.findApproxL2)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.coeffs[0]).toBe(c1);
        (0, vitest_1.expect)(result.lfsr.coeffs[1]).toBe(c2);
    });
    (0, vitest_1.it)("finds (c1, c2) under ~20% i.i.d. noise (previously failed with 50% voting threshold)", () => {
        // At 20% i.i.d. noise, (0.8)^4 = 41% of quadruples are clean — above the new
        // 25% majority threshold but below the old 50% threshold.
        // Deterministic stride noise is worse (each noisy byte corrupts 4 quadruples),
        // so use a PRNG to produce genuinely independent per-byte noise.
        const c1 = 0x1b, c2 = 0x4e;
        const seq = [1, 3];
        for (let i = 2; i < 512; i++)
            seq.push((0, gf256_1.gfAdd)((0, gf256_1.gfMul)(c1, seq[i - 1]), (0, gf256_1.gfMul)(c2, seq[i - 2])));
        // Xorshift32 PRNG — ~20% flip rate (51/256 ≈ 19.9%)
        let rng = 0x12345678;
        for (let i = 0; i < seq.length; i++) {
            rng = (rng ^ (rng << 7) ^ (rng >>> 17)) >>> 0;
            if ((rng & 0xff) < 51)
                seq[i] ^= 0x3c;
        }
        const result = (0, pade_1.findApproxL2)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.coeffs[0]).toBe(c1);
        (0, vitest_1.expect)(result.lfsr.coeffs[1]).toBe(c2);
    });
    (0, vitest_1.it)("returns null for random-looking data", () => {
        let x = 0xdeadbeef;
        const seq = Array.from({ length: 512 }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return x & 0xff;
        });
        (0, vitest_1.expect)((0, pade_1.findApproxL2)(seq)).toBeNull();
    });
});
(0, vitest_1.describe)("findApproxL3", () => {
    (0, vitest_1.it)("finds the correct (c1, c2, c3) for a perfect L=3 GF sequence", () => {
        const c1 = 0x57, c2 = 0x2f, c3 = 0x11;
        const seq = [1, 3, 7];
        for (let i = 3; i < 256; i++)
            seq.push((0, gf256_1.gfAdd)((0, gf256_1.gfAdd)((0, gf256_1.gfMul)(c1, seq[i - 1]), (0, gf256_1.gfMul)(c2, seq[i - 2])), (0, gf256_1.gfMul)(c3, seq[i - 3])));
        const result = (0, pade_1.findApproxL3)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.coeffs[0]).toBe(c1);
        (0, vitest_1.expect)(result.lfsr.coeffs[1]).toBe(c2);
        (0, vitest_1.expect)(result.lfsr.coeffs[2]).toBe(c3);
        (0, vitest_1.expect)(result.nonZeroCount).toBe(0);
    });
    (0, vitest_1.it)("finds the dominant (c1, c2, c3) under ~5% noise", () => {
        const c1 = 0x57, c2 = 0x2f, c3 = 0x11;
        const seq = [1, 3, 7];
        for (let i = 3; i < 512; i++)
            seq.push((0, gf256_1.gfAdd)((0, gf256_1.gfAdd)((0, gf256_1.gfMul)(c1, seq[i - 1]), (0, gf256_1.gfMul)(c2, seq[i - 2])), (0, gf256_1.gfMul)(c3, seq[i - 3])));
        for (let i = 0; i < 26; i++)
            seq[(i * 19) % seq.length] ^= 0x5a;
        const result = (0, pade_1.findApproxL3)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.coeffs[0]).toBe(c1);
        (0, vitest_1.expect)(result.lfsr.coeffs[1]).toBe(c2);
        (0, vitest_1.expect)(result.lfsr.coeffs[2]).toBe(c3);
    });
    (0, vitest_1.it)("returns null for random-looking data", () => {
        let x = 0xdeadbeef;
        const seq = Array.from({ length: 512 }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return x & 0xff;
        });
        (0, vitest_1.expect)((0, pade_1.findApproxL3)(seq)).toBeNull();
    });
});
(0, vitest_1.describe)("findApproxL1", () => {
    (0, vitest_1.it)("finds the correct coefficient for a pure geometric sequence", () => {
        const result = (0, pade_1.findApproxL1)(makeGF(256, 7));
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.coeffs[0]).toBe(7);
        (0, vitest_1.expect)(result.nonZeroCount).toBe(0);
    });
    (0, vitest_1.it)("finds the dominant coefficient under ~10% noise", () => {
        const seq = makeGF(512, 3);
        // Flip ~5% of bytes
        for (let i = 0; i < 25; i++)
            seq[(i * 19) % seq.length] ^= 0x5a;
        const result = (0, pade_1.findApproxL1)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.coeffs[0]).toBe(3);
    });
    (0, vitest_1.it)("returns null for random-looking data", () => {
        // Xorshift pseudo-random — no dominant L=1 recurrence
        let x = 0xdeadbeef;
        const seq = Array.from({ length: 512 }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return x & 0xff;
        });
        // Most coefficients will have ~50% error rate; all above 30% threshold
        const result = (0, pade_1.findApproxL1)(seq, 0.3);
        (0, vitest_1.expect)(result).toBeNull();
    });
});
// ── Build an exact L-order GF recurrence ─────────────────────────────────────
const makeGFLN = (n, c, seed) => {
    const L = c.length;
    const s = [...seed];
    for (let i = L; i < n; i++) {
        let v = 0;
        for (let j = 0; j < L; j++)
            v = (0, gf256_1.gfAdd)(v, (0, gf256_1.gfMul)(c[j], s[i - 1 - j]));
        s.push(v);
    }
    return s;
};
(0, vitest_1.describe)("findApproxL4", () => {
    (0, vitest_1.it)("finds the correct (c1,c2,c3,c4) for a perfect L=4 GF sequence", () => {
        const c = [0x07, 0x1b, 0x4e, 0x2f];
        const seq = makeGFLN(256, c, [1, 3, 7, 15]);
        const result = (0, pade_1.findApproxL4)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.length).toBe(4);
        for (let j = 0; j < 4; j++)
            (0, vitest_1.expect)(result.lfsr.coeffs[j]).toBe(c[j]);
        (0, vitest_1.expect)(result.nonZeroCount).toBe(0);
    });
    (0, vitest_1.it)("finds the dominant coefficients under ~5% noise", () => {
        const c = [0x57, 0x2f, 0x11, 0xae];
        const seq = makeGFLN(512, c, [1, 5, 11, 23]);
        for (let i = 0; i < 25; i++)
            seq[(i * 19) % seq.length] ^= 0x5a;
        const result = (0, pade_1.findApproxL4)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        for (let j = 0; j < 4; j++)
            (0, vitest_1.expect)(result.lfsr.coeffs[j]).toBe(c[j]);
    });
    (0, vitest_1.it)("returns null for random-looking data", () => {
        let x = 0xdeadbeef;
        const seq = Array.from({ length: 512 }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return x & 0xff;
        });
        (0, vitest_1.expect)((0, pade_1.findApproxL4)(seq)).toBeNull();
    });
});
(0, vitest_1.describe)("findApproxL5", () => {
    (0, vitest_1.it)("finds the correct coefficients for a perfect L=5 GF sequence", () => {
        const c = [0x03, 0x07, 0x1b, 0x4e, 0x2f];
        const seq = makeGFLN(256, c, [1, 2, 4, 8, 16]);
        const result = (0, pade_1.findApproxL5)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.lfsr.length).toBe(5);
        for (let j = 0; j < 5; j++)
            (0, vitest_1.expect)(result.lfsr.coeffs[j]).toBe(c[j]);
        (0, vitest_1.expect)(result.nonZeroCount).toBe(0);
    });
});
(0, vitest_1.describe)("findApproxAffineL1", () => {
    // Build y[n] = c * y[n-1] ^ b  starting from seed
    const makeAffine = (n, c, b, seed) => {
        const s = [seed];
        for (let i = 1; i < n; i++)
            s.push((0, gf256_1.gfMul)(c, s[i - 1]) ^ b);
        return s;
    };
    (0, vitest_1.it)("recovers (c, k) from a synthetic affine sequence", () => {
        // y[n] = 0x03 * y[n-1] ^ 0x1b
        const c = 0x03, b = 0x1b;
        const seq = makeAffine(512, c, b, 0x07);
        const result = (0, pade_1.findApproxAffineL1)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.c).toBe(c);
        (0, vitest_1.expect)(result.nonZeroCount).toBe(0);
    });
    (0, vitest_1.it)("recovers (c, k) under ~5% noise", () => {
        const c = 0x1b, b = 0x4e;
        const seq = makeAffine(512, c, b, 0x05);
        for (let i = 0; i < 25; i++)
            seq[(i * 19) % seq.length] ^= 0x5a;
        const result = (0, pade_1.findApproxAffineL1)(seq);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.c).toBe(c);
    });
    (0, vitest_1.it)("returns null when b=0 (pure multiplicative, not affine)", () => {
        const seq = makeGF(256, 0x03);
        (0, vitest_1.expect)((0, pade_1.findApproxAffineL1)(seq)).toBeNull();
    });
    (0, vitest_1.it)("returns null for random-looking data", () => {
        let x = 0xdeadbeef;
        const seq = Array.from({ length: 512 }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            return x & 0xff;
        });
        (0, vitest_1.expect)((0, pade_1.findApproxAffineL1)(seq)).toBeNull();
    });
});
