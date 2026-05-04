"use strict";
// GF(p) arithmetic — all results are in [0, p)
Object.defineProperty(exports, "__esModule", { value: true });
exports.neg = exports.div = exports.mul = exports.sub = exports.add = exports.modInv = exports.mod = void 0;
const mod = (a, p) => ((a % p) + p) % p;
exports.mod = mod;
// Modular inverse via extended Euclidean; p must be prime
const modInv = (a, p) => {
    let [r, nr] = [p, (0, exports.mod)(a, p)];
    let [s, ns] = [0n, 1n];
    while (nr !== 0n) {
        const q = r / nr;
        [r, nr] = [nr, r - q * nr];
        [s, ns] = [ns, s - q * ns];
    }
    return (0, exports.mod)(s, p);
};
exports.modInv = modInv;
const add = (a, b, p) => (0, exports.mod)(a + b, p);
exports.add = add;
const sub = (a, b, p) => (0, exports.mod)(a - b, p);
exports.sub = sub;
const mul = (a, b, p) => (0, exports.mod)(a * b, p);
exports.mul = mul;
const div = (a, b, p) => (0, exports.mul)(a, (0, exports.modInv)(b, p), p);
exports.div = div;
const neg = (a, p) => (0, exports.mod)(-a, p);
exports.neg = neg;
