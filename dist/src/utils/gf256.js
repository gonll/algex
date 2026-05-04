"use strict";
// GF(2^8) arithmetic using AES irreducible polynomial: x^8 + x^4 + x^3 + x + 1
// All 256 byte values are native field elements — no overflow, no mapping needed.
// Multiplication is O(1) via precomputed log/exp tables.
Object.defineProperty(exports, "__esModule", { value: true });
exports.gfOrder = exports.gfDiv = exports.gfInv = exports.gfMul = exports.gfNeg = exports.gfSub = exports.gfAdd = void 0;
const buildTables = () => {
    const LOG = new Uint8Array(256);
    const EXP = new Uint8Array(512); // doubled for wrap-free index arithmetic
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        // Multiply by the primitive element 3 (= x + 1 in GF(2^8))
        x ^= (x << 1) ^ (x & 0x80 ? 0x1b : 0);
        x &= 0xff;
    }
    // Mirror table to avoid modulo in gfMul
    for (let i = 255; i < 512; i++)
        EXP[i] = EXP[i - 255];
    return { LOG, EXP };
};
const { LOG, EXP } = buildTables();
// Addition and subtraction are identical in GF(2^8) (characteristic 2)
const gfAdd = (a, b) => a ^ b;
exports.gfAdd = gfAdd;
exports.gfSub = exports.gfAdd;
// Negation is identity in characteristic 2: -a = a
const gfNeg = (a) => a;
exports.gfNeg = gfNeg;
const gfMul = (a, b) => {
    if (a === 0 || b === 0)
        return 0;
    return EXP[LOG[a] + LOG[b]];
};
exports.gfMul = gfMul;
const gfInv = (a) => {
    if (a === 0)
        throw new Error("GF(256): inverse of 0 is undefined");
    return EXP[255 - LOG[a]];
};
exports.gfInv = gfInv;
const gfDiv = (a, b) => (0, exports.gfMul)(a, (0, exports.gfInv)(b));
exports.gfDiv = gfDiv;
// Multiplicative order of a in GF(2^8)*: smallest k ≥ 1 with a^k = 1.
// Returns 0 for a=0 (no order). Divisors of 255: 1,3,5,15,17,51,85,255.
const gfOrder = (a) => {
    if (a === 0)
        return 0;
    if (a === 1)
        return 1;
    let x = a;
    for (let k = 1; k < 255; k++) {
        x = (0, exports.gfMul)(x, a);
        if (x === 1)
            return k + 1;
    }
    return 255;
};
exports.gfOrder = gfOrder;
