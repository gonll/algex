"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const transform_1 = require("./transform");
const makeRandom = (n, seed) => {
    let s = seed >>> 0;
    return Uint8Array.from({ length: n }, () => {
        s = (Math.imul(1664525, s) + 1013904223) >>> 0;
        return s & 0xff;
    });
};
(0, vitest_1.describe)("huffmanEstimate", () => {
    (0, vitest_1.it)("returns 0 for all-same-byte input (single symbol, zero entropy)", () => {
        (0, vitest_1.expect)((0, transform_1.huffmanEstimate)(new Uint8Array(1000).fill(0x42))).toBe(0);
    });
    (0, vitest_1.it)("approaches N*8 for uniform distribution", () => {
        const buf = Uint8Array.from({ length: 256 * 4 }, (_, i) => i & 0xff);
        const est = (0, transform_1.huffmanEstimate)(buf);
        // Uniform 256 symbols: entropy = 8 bits/byte; with 1.05 overhead ≈ 8.4 bits/byte
        (0, vitest_1.expect)(est).toBeGreaterThan(buf.length * 7.5);
        (0, vitest_1.expect)(est).toBeLessThanOrEqual(Math.ceil(buf.length * 8 * 1.05 + 1));
    });
});
(0, vitest_1.describe)("shouldTryTransforms", () => {
    (0, vitest_1.it)("returns false for constant (zero entropy) data", () => {
        (0, vitest_1.expect)((0, transform_1.shouldTryTransforms)(new Uint8Array(1024).fill(0xab))).toBe(false);
    });
    (0, vitest_1.it)("returns false for low-entropy repeated-pattern data", () => {
        const buf = new Uint8Array(1024);
        for (let i = 0; i < buf.length; i++)
            buf[i] = i & 0x03; // 4 distinct values
        (0, vitest_1.expect)((0, transform_1.shouldTryTransforms)(buf)).toBe(false);
    });
    (0, vitest_1.it)("returns true for high-entropy (random-looking) data", () => {
        (0, vitest_1.expect)((0, transform_1.shouldTryTransforms)(makeRandom(1024, 0xdeadbeef))).toBe(true);
    });
    (0, vitest_1.it)("returns false for buffers shorter than 16 bytes", () => {
        (0, vitest_1.expect)((0, transform_1.shouldTryTransforms)(makeRandom(8, 42))).toBe(false);
    });
});
(0, vitest_1.describe)("baselineCost", () => {
    (0, vitest_1.it)("is rawCost for high-entropy data", () => {
        const buf = makeRandom(256, 0xcafe);
        (0, vitest_1.expect)((0, transform_1.baselineCost)(buf)).toBeLessThanOrEqual((0, transform_1.rawCost)(buf));
    });
    (0, vitest_1.it)("is less than rawCost for compressible data", () => {
        const buf = new Uint8Array(256).fill(0x41);
        (0, vitest_1.expect)((0, transform_1.baselineCost)(buf)).toBeLessThan((0, transform_1.rawCost)(buf));
    });
});
// ── Delta roundtrips ──────────────────────────────────────────────────────────
const roundtrips = (apply, invert, buf) => (0, vitest_1.expect)(invert(apply(buf))).toEqual(buf);
(0, vitest_1.describe)("deltaXor1 roundtrip", () => {
    (0, vitest_1.it)("identity on empty buffer", () => roundtrips(transform_1.deltaXor1Apply, transform_1.deltaXor1Invert, new Uint8Array(0)));
    (0, vitest_1.it)("identity on single byte", () => roundtrips(transform_1.deltaXor1Apply, transform_1.deltaXor1Invert, new Uint8Array([0x42])));
    (0, vitest_1.it)("identity on random bytes", () => roundtrips(transform_1.deltaXor1Apply, transform_1.deltaXor1Invert, makeRandom(1024, 0x1111)));
    (0, vitest_1.it)("identity on constant bytes", () => roundtrips(transform_1.deltaXor1Apply, transform_1.deltaXor1Invert, new Uint8Array(256).fill(0x55)));
    (0, vitest_1.it)("turns a counter sequence 0,1,2,... into constant 1s", () => {
        const counter = Uint8Array.from({ length: 256 }, (_, i) => i & 0xff);
        const diff = (0, transform_1.deltaAdd1Apply)(counter);
        (0, vitest_1.expect)(diff.slice(1).every(b => b === 1)).toBe(true);
    });
});
(0, vitest_1.describe)("deltaAdd1 roundtrip", () => {
    (0, vitest_1.it)("identity on empty buffer", () => roundtrips(transform_1.deltaAdd1Apply, transform_1.deltaAdd1Invert, new Uint8Array(0)));
    (0, vitest_1.it)("identity on single byte", () => roundtrips(transform_1.deltaAdd1Apply, transform_1.deltaAdd1Invert, new Uint8Array([0x99])));
    (0, vitest_1.it)("identity on random bytes", () => roundtrips(transform_1.deltaAdd1Apply, transform_1.deltaAdd1Invert, makeRandom(1024, 0x2222)));
    (0, vitest_1.it)("turns wrapping counter 0..255,0..255 into constant 1s (except wrap)", () => {
        const counter = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff);
        const diff = (0, transform_1.deltaAdd1Apply)(counter);
        // All differences are 1 (wrapping is also 1 mod 256)
        (0, vitest_1.expect)(diff.slice(1).every(b => b === 1)).toBe(true);
    });
});
(0, vitest_1.describe)("deltaXor2 roundtrip", () => {
    (0, vitest_1.it)("identity on random bytes", () => roundtrips(transform_1.deltaXor2Apply, transform_1.deltaXor2Invert, makeRandom(1024, 0x3333)));
    (0, vitest_1.it)("identity on empty buffer", () => roundtrips(transform_1.deltaXor2Apply, transform_1.deltaXor2Invert, new Uint8Array(0)));
});
(0, vitest_1.describe)("DELTA_TRANSFORMS array", () => {
    (0, vitest_1.it)("all transforms are invertible on random data", () => {
        const buf = makeRandom(512, 0xabcd);
        for (const dt of transform_1.DELTA_TRANSFORMS) {
            (0, vitest_1.expect)(dt.invert(dt.apply(buf))).toEqual(buf);
        }
    });
    (0, vitest_1.it)("IDs are 3, 4, 5", () => {
        (0, vitest_1.expect)(transform_1.DELTA_TRANSFORMS.map(d => d.id)).toEqual([3, 4, 5]);
    });
});
