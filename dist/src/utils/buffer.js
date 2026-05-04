"use strict";
// Buffer ↔ GF(2^8) element array conversions and shared byte utilities
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAllZero = exports.concatBytes = exports.xorBytes = exports.fromSeq = exports.toSeq = void 0;
// GF(2^8) elements are just byte values — no conversion needed beyond typing
const toSeq = (buf) => Array.from(buf);
exports.toSeq = toSeq;
const fromSeq = (seq) => Uint8Array.from(seq);
exports.fromSeq = fromSeq;
// XOR two equal-length buffers. If b is empty, a is returned unchanged.
const xorBytes = (a, b) => b.length === 0
    ? Uint8Array.from(a)
    : Uint8Array.from(a, (v, i) => v ^ b[i]);
exports.xorBytes = xorBytes;
// Concatenate an array of Uint8Arrays into one flat buffer
const concatBytes = (parts) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};
exports.concatBytes = concatBytes;
// True when every byte in buf is 0
const isAllZero = (buf) => buf.every((b) => b === 0);
exports.isAllZero = isAllZero;
