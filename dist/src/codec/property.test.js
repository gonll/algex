"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("../index");
const gf256_1 = require("../utils/gf256");
// ---------------------------------------------------------------------------
// Deterministic LCG — avoids Math.random() so tests are fully reproducible.
// Parameters: multiplier=1664525, increment=1013904223 (Numerical Recipes)
// ---------------------------------------------------------------------------
const lcg = (seed) => {
    let s = seed >>> 0;
    return () => {
        s = ((Math.imul(1664525, s) + 1013904223) >>> 0);
        return s;
    };
};
// ---------------------------------------------------------------------------
// Pure generator helpers
// ---------------------------------------------------------------------------
/** L=1: s[i] = coeff^i * seed  (geometric sequence in GF(2^8)) */
const makeL1 = (n, coeff, seed = 1) => {
    const buf = new Uint8Array(n);
    let cur = seed & 0xff;
    for (let i = 0; i < n; i++) {
        buf[i] = cur;
        cur = (0, gf256_1.gfMul)(coeff, cur);
    }
    return buf;
};
/** L=2: s[i] = c1*s[i-1] XOR c2*s[i-2] */
const makeL2 = (n, c1, c2) => {
    const buf = new Uint8Array(n);
    if (n === 0)
        return buf;
    buf[0] = 1;
    if (n === 1)
        return buf;
    buf[1] = c1; // c1*1 XOR c2*0 = c1
    for (let i = 2; i < n; i++) {
        buf[i] = (0, gf256_1.gfMul)(c1, buf[i - 1]) ^ (0, gf256_1.gfMul)(c2, buf[i - 2]);
    }
    return buf;
};
/** L=3: s[i] = c1*s[i-1] XOR c2*s[i-2] XOR c3*s[i-3] */
const makeL3 = (n, c1, c2, c3) => {
    const buf = new Uint8Array(n);
    if (n === 0)
        return buf;
    buf[0] = 1;
    if (n === 1)
        return buf;
    buf[1] = c1;
    if (n === 2)
        return buf;
    buf[2] = (0, gf256_1.gfMul)(c1, buf[1]) ^ (0, gf256_1.gfMul)(c2, buf[0]);
    for (let i = 3; i < n; i++) {
        buf[i] = (0, gf256_1.gfMul)(c1, buf[i - 1]) ^ (0, gf256_1.gfMul)(c2, buf[i - 2]) ^ (0, gf256_1.gfMul)(c3, buf[i - 3]);
    }
    return buf;
};
/** XOR random non-zero bytes at random positions at the given rate. */
const addNoise = (buf, rate, seed) => {
    const out = new Uint8Array(buf);
    const rand = lcg(seed);
    for (let i = 0; i < out.length; i++) {
        if ((rand() / 0xffffffff) < rate) {
            // non-zero XOR mask
            const mask = (rand() % 255) + 1;
            out[i] ^= mask;
        }
    }
    return out;
};
/** Concatenate Uint8Arrays. */
const concat = (...parts) => {
    const total = parts.reduce((acc, p) => acc + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
};
/** Core assertion: compress → decompress is the identity. */
const assertRoundtrip = (input) => {
    const compressed = (0, index_1.compress)(input);
    const decompressed = (0, index_1.decompress)(compressed);
    (0, vitest_1.expect)(decompressed).toEqual(input);
};
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
(0, vitest_1.describe)("exact GF structure (0% noise) — roundtrip + compression", () => {
    (0, vitest_1.describe)("L=1: all 255 non-zero coefficients, length=1024", () => {
        // Test a representative sample of the 255 coefficients to keep runtime sane.
        // The full sweep is exercised in the compression-ratio sub-group below.
        for (const coeff of [2, 3, 7, 15, 31, 63, 127, 255, 0x1b, 0x63, 0xe5]) {
            (0, vitest_1.it)(`coeff=0x${coeff.toString(16).padStart(2, "0")}`, () => {
                const input = makeL1(1024, coeff);
                assertRoundtrip(input);
                const ratio = (0, index_1.compress)(input).length / input.length;
                (0, vitest_1.expect)(ratio).toBeLessThan(1.0);
            });
        }
    });
    (0, vitest_1.it)("L=1 coeff=3, all 255 GF coefficients compress smaller than raw", () => {
        // Verify compression wins for every non-zero coefficient at length=1024.
        for (let coeff = 1; coeff <= 255; coeff++) {
            const input = makeL1(1024, coeff);
            const ratio = (0, index_1.compress)(input).length / input.length;
            (0, vitest_1.expect)(ratio).toBeLessThan(1.0);
        }
    });
    (0, vitest_1.it)("L=2 (c1=2, c2=3), length=2048", () => {
        const input = makeL2(2048, 2, 3);
        assertRoundtrip(input);
        (0, vitest_1.expect)((0, index_1.compress)(input).length).toBeLessThan(input.length);
    });
    (0, vitest_1.it)("L=2 (c1=7, c2=11), length=2048", () => {
        const input = makeL2(2048, 7, 11);
        assertRoundtrip(input);
        (0, vitest_1.expect)((0, index_1.compress)(input).length).toBeLessThan(input.length);
    });
    (0, vitest_1.it)("L=2 (c1=0x1b, c2=0x63), length=2048", () => {
        const input = makeL2(2048, 0x1b, 0x63);
        assertRoundtrip(input);
        (0, vitest_1.expect)((0, index_1.compress)(input).length).toBeLessThan(input.length);
    });
    (0, vitest_1.it)("L=3 (c1=2, c2=3, c3=5), length=2048", () => {
        const input = makeL3(2048, 2, 3, 5);
        assertRoundtrip(input);
        (0, vitest_1.expect)((0, index_1.compress)(input).length).toBeLessThan(input.length);
    });
    (0, vitest_1.it)("L=3 (c1=7, c2=11, c3=13), length=2048", () => {
        const input = makeL3(2048, 7, 11, 13);
        assertRoundtrip(input);
        (0, vitest_1.expect)((0, index_1.compress)(input).length).toBeLessThan(input.length);
    });
    (0, vitest_1.it)("L=3 (c1=0x1b, c2=0x63, c3=0xe5), length=2048", () => {
        const input = makeL3(2048, 0x1b, 0x63, 0xe5);
        assertRoundtrip(input);
        (0, vitest_1.expect)((0, index_1.compress)(input).length).toBeLessThan(input.length);
    });
});
(0, vitest_1.describe)("noisy GF structure — roundtrip must still be identity", () => {
    (0, vitest_1.it)("L=1 coeff=3, 5% noise, length=4096", () => {
        const input = addNoise(makeL1(4096, 3), 0.05, 42);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("L=1 coeff=3, 10% noise, length=4096", () => {
        const input = addNoise(makeL1(4096, 3), 0.10, 43);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("L=1 coeff=7, 5% noise, length=4096", () => {
        const input = addNoise(makeL1(4096, 7), 0.05, 44);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("L=2 (c1=2, c2=3), 3% noise, length=4096", () => {
        const input = addNoise(makeL2(4096, 2, 3), 0.03, 45);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("L=2 (c1=7, c2=11), 3% noise, length=4096", () => {
        const input = addNoise(makeL2(4096, 7, 11), 0.03, 46);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("L=3 (c1=2, c2=3, c3=5), 2% noise, length=4096", () => {
        const input = addNoise(makeL3(4096, 2, 3, 5), 0.02, 47);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("L=3 (c1=7, c2=11, c3=13), 2% noise, length=4096", () => {
        const input = addNoise(makeL3(4096, 7, 11, 13), 0.02, 48);
        assertRoundtrip(input);
    });
});
(0, vitest_1.describe)("edge cases", () => {
    (0, vitest_1.it)("empty input (0 bytes)", () => {
        assertRoundtrip(new Uint8Array(0));
    });
    (0, vitest_1.it)("single byte", () => {
        assertRoundtrip(new Uint8Array([0xab]));
    });
    (0, vitest_1.it)("128 bytes (min chunk size)", () => {
        const input = makeL1(128, 3);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("exactly MAX_CHUNK=4096 bytes of L=1", () => {
        const input = makeL1(4096, 5);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("4097 bytes (crosses chunk boundary)", () => {
        const input = makeL1(4097, 5);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("65536 bytes (16 chunks of L=1)", () => {
        const input = makeL1(65536, 3);
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("all-zero bytes (128 bytes)", () => {
        assertRoundtrip(new Uint8Array(128).fill(0));
    });
    (0, vitest_1.it)("all-same byte 0xff (1024 bytes)", () => {
        assertRoundtrip(new Uint8Array(1024).fill(0xff));
    });
    (0, vitest_1.it)("all-same byte 0x42 (4096 bytes)", () => {
        assertRoundtrip(new Uint8Array(4096).fill(0x42));
    });
    (0, vitest_1.it)("all distinct bytes cycling 0..255 (256 bytes)", () => {
        const input = new Uint8Array(256);
        for (let i = 0; i < 256; i++)
            input[i] = i;
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("high-entropy deterministic data (4096 bytes)", () => {
        // Use LCG to produce pseudo-random bytes with no algebraic GF structure.
        const rand = lcg(0xdeadbeef);
        const input = new Uint8Array(4096);
        for (let i = 0; i < 4096; i++)
            input[i] = rand() & 0xff;
        assertRoundtrip(input);
    });
});
(0, vitest_1.describe)("mixed segments", () => {
    (0, vitest_1.it)("L=1(128KB) + high-entropy(64KB) + L=1-different-coeff(128KB)", () => {
        const rand = lcg(0xc0ffee);
        const noisy = new Uint8Array(64 * 1024);
        for (let i = 0; i < noisy.length; i++)
            noisy[i] = rand() & 0xff;
        const input = concat(makeL1(128 * 1024, 3), noisy, makeL1(128 * 1024, 7));
        assertRoundtrip(input);
    });
    (0, vitest_1.it)("L=2(256KB) + L=3-noisy(256KB)", () => {
        const l2 = makeL2(256 * 1024, 2, 3);
        const l3noisy = addNoise(makeL3(256 * 1024, 7, 11, 13), 0.02, 99);
        assertRoundtrip(concat(l2, l3noisy));
    });
});
