"use strict";
// Pade [k/L] approximant search + approximate LFSR detection.
// All heavy math (BM, L=1..5 voting) delegates to the C addon.
// TypeScript handles coordination, size gating, and seed denoising only.
Object.defineProperty(exports, "__esModule", { value: true });
exports.findApproxAffineL1 = exports.findApproxL5 = exports.findApproxL4 = exports.findApproxLN = exports.findApproxL3 = exports.findApproxL2 = exports.findApproxL1 = exports.findBestPade = exports.refinedSize = void 0;
const sparse_1 = require("../utils/sparse");
const addon_1 = require("../native/addon");
const gf256_1 = require("../utils/gf256");
const estimateSize = (offset, L, residualSize) => 1 + 4 + 1 + offset + 2 + 2 * L + residualSize;
const refinedSize = (offset, L, residual) => estimateSize(offset, L, (0, sparse_1.packedResidualSize)(residual));
exports.refinedSize = refinedSize;
// C bm_solve and lfsr_run both cap at BM_MAX_L = 64.
const BM_HARD_LIMIT = 64;
const QUICK_CAP = 8;
const QUICK_WINDOW = 2 * QUICK_CAP + 4;
const findBestPade = (seq, maxOffset = 32, maxL) => {
    const cap = Math.min(maxL ?? Math.ceil(seq.length * 0.25), BM_HARD_LIMIT);
    const maxOff = Math.min(maxOffset, seq.length - 4);
    let bestScore = Infinity;
    let best = { offset: 0, lfsr: { coeffs: [], length: cap + 1 }, init: [] };
    // Prescreen with a short window to avoid O(N^2) BM on non-LFSR data.
    let quickPass = false;
    for (let k = 0; k <= maxOff; k += 4) {
        const win = seq.slice(k, k + QUICK_WINDOW);
        if (addon_1.addon.bmSolve(Buffer.from(win)).length <= QUICK_CAP) {
            quickPass = true;
            break;
        }
    }
    if (!quickPass)
        return best;
    for (let k = 0; k <= maxOff; k++) {
        const sub = seq.slice(k);
        const r = addon_1.addon.bmSolve(Buffer.from(sub));
        if (r.length > cap) {
            if (k === 0)
                break;
            continue;
        }
        const score = estimateSize(k, r.length, 1);
        if (score < bestScore) {
            bestScore = score;
            best = { offset: k, lfsr: { coeffs: r.coeffs, length: r.length }, init: sub.slice(0, r.length) };
        }
    }
    return best;
};
exports.findBestPade = findBestPade;
const findApproxL1 = (seq, sparsityThreshold = 0.3) => {
    if (seq.length < 2)
        return null;
    const r = addon_1.addon.approxL1(Buffer.from(seq));
    if (r.errCount / seq.length > sparsityThreshold)
        return null;
    return { lfsr: { coeffs: [r.coeff], length: 1 }, init: [seq[0]], nonZeroCount: r.errCount };
};
exports.findApproxL1 = findApproxL1;
const findApproxL2 = (seq, sparsityThreshold = 0.3) => {
    if (seq.length < 4)
        return null;
    const r = addon_1.addon.approxL2(Buffer.from(seq));
    if (!r)
        return null;
    if (r.err / seq.length > 1 - Math.pow(1 - sparsityThreshold, 3))
        return null;
    return { lfsr: { coeffs: r.coeffs, length: 2 }, init: [seq[0], seq[1]], nonZeroCount: r.err };
};
exports.findApproxL2 = findApproxL2;
const findApproxL3 = (seq, sparsityThreshold = 0.3) => {
    if (seq.length < 8)
        return null;
    const r = addon_1.addon.approxL3(Buffer.from(seq));
    if (!r)
        return null;
    if (r.err / seq.length > 1 - Math.pow(1 - sparsityThreshold, 4))
        return null;
    return { lfsr: { coeffs: r.coeffs, length: 3 }, init: [seq[0], seq[1], seq[2]], nonZeroCount: r.err };
};
exports.findApproxL3 = findApproxL3;
const findApproxLN = (seq, targetL, sparsityThreshold = 0.3) => {
    if (seq.length < 2 * targetL + 4)
        return null;
    const r = addon_1.addon.approxLn(Buffer.from(seq), targetL);
    if (!r)
        return null;
    if (r.err / seq.length > 1 - Math.pow(1 - sparsityThreshold, targetL + 1))
        return null;
    return { lfsr: { coeffs: r.coeffs, length: targetL }, init: seq.slice(0, targetL), nonZeroCount: r.err };
};
exports.findApproxLN = findApproxLN;
const findApproxL4 = (seq, sparsityThreshold = 0.3) => (0, exports.findApproxLN)(seq, 4, sparsityThreshold);
exports.findApproxL4 = findApproxL4;
const findApproxL5 = (seq, sparsityThreshold = 0.3) => (0, exports.findApproxLN)(seq, 5, sparsityThreshold);
exports.findApproxL5 = findApproxL5;
// Detects sequences of the form y[n] = c * y[n-1] ^ b (affine L=1 recurrence).
// After the closed-form shift z[n] = y[n] ^ k where k = b / (1 ^ c), the shifted
// sequence satisfies z[n] = c * z[n-1] — a pure multiplicative recurrence found
// by findApproxL1. Skips b=0 (pure multiplicative, already handled by findApproxL1).
const findApproxAffineL1 = (seq, sparsityThreshold = 0.3) => {
    const n = seq.length;
    if (n < 4)
        return null;
    // Vote for c using consecutive triples: c = (y[i] ^ y[i+1]) / (y[i-1] ^ y[i])
    // For y[n] = c*y[n-1] ^ b: numerator = c*(y[i-1]^y[i]), denominator = y[i-1]^y[i].
    // Cancels to c regardless of b, unlike the naive y[i]/y[i-1] ratio which doesn't.
    const cVotes = new Uint32Array(256);
    let totalVotes = 0;
    for (let i = 1; i + 1 < n; i++) {
        const denom = seq[i - 1] ^ seq[i];
        if (denom === 0)
            continue; // y[i]=y[i-1]: indeterminate
        const numer = seq[i] ^ seq[i + 1];
        cVotes[(0, gf256_1.gfMul)(numer, (0, gf256_1.gfInv)(denom))]++;
        totalVotes++;
    }
    if (totalVotes < 4)
        return null;
    let bestC = 0, bestCVotes = 0;
    for (let c = 1; c < 256; c++) {
        if (cVotes[c] > bestCVotes) {
            bestCVotes = cVotes[c];
            bestC = c;
        }
    }
    // Require >20% plurality (random data gives ~1/255 ≈ 0.4% per bucket)
    if (bestCVotes < totalVotes * 0.20)
        return null;
    // Vote for b = y[i] ^ (c * y[i-1]) with the winning c
    const bVotes = new Uint32Array(256);
    for (let i = 1; i < n; i++) {
        bVotes[seq[i] ^ (0, gf256_1.gfMul)(bestC, seq[i - 1])]++;
    }
    let bestB = 0, bestBVotes = 0;
    for (let b = 0; b < 256; b++) {
        if (bVotes[b] > bestBVotes) {
            bestBVotes = bVotes[b];
            bestB = b;
        }
    }
    // b=0 means pure multiplicative — findApproxL1 already handles this
    if (bestB === 0)
        return null;
    // Solve k = b / (1 ^ c); skip when c=1 (denom=0, no unique fixed point)
    const denom = 1 ^ bestC;
    if (denom === 0)
        return null;
    const k = (0, gf256_1.gfMul)(bestB, (0, gf256_1.gfInv)(denom));
    // Shift the sequence and verify with findApproxL1
    const shifted = seq.map(v => v ^ k);
    const l1 = (0, exports.findApproxL1)(shifted, sparsityThreshold);
    if (!l1)
        return null;
    return {
        c: bestC,
        k,
        lfsr: l1.lfsr,
        init: [(seq[0] ^ k)],
        nonZeroCount: l1.nonZeroCount,
    };
};
exports.findApproxAffineL1 = findApproxAffineL1;
