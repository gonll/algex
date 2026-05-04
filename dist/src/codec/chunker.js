"use strict";
// Fixed and entropy-adaptive chunk strategies.
// Adaptive splits where Shannon entropy shifts significantly — the LFSR on each side
// of a boundary is shorter than one spanning the whole mixed region.
//
// Second pass: model-stability split.  After entropy-based chunking, any chunk where
// BM fails (linear complexity > L_CAP) but BOTH halves succeed is split at the midpoint
// and the process repeats.  This catches LFSR-order transitions that entropy misses
// (both sides of a L=1→L=3 boundary look identical to Shannon entropy).
Object.defineProperty(exports, "__esModule", { value: true });
exports.adaptiveChunks = exports.fixedChunks = void 0;
const entropy_1 = require("../core/entropy");
const addon_1 = require("../native/addon");
const FIXED_CHUNK_SIZE = 512;
const WINDOW = 64; // entropy sample window
const DELTA_THRESHOLD = 1.5; // bits/byte change to trigger a split
const MIN_CHUNK = 128;
const MAX_CHUNK = 4096;
const fixedChunks = (buf, size = FIXED_CHUNK_SIZE) => {
    const out = [];
    for (let i = 0; i < buf.length; i += size)
        out.push(buf.slice(i, Math.min(i + size, buf.length)));
    return out;
};
exports.fixedChunks = fixedChunks;
// Compute the entropy contrast (|after − before|) at a candidate split point.
const splitContrast = (buf, pos) => {
    const lo = Math.max(0, pos - WINDOW);
    const hi = Math.min(buf.length, pos + WINDOW);
    if (pos - lo < 8 || hi - pos < 8)
        return 0;
    const before = (0, entropy_1.shannonEntropy)(buf.slice(lo, pos));
    const after = (0, entropy_1.shannonEntropy)(buf.slice(pos, hi));
    return Math.abs(after - before);
};
// After detecting a split, try ±REFINE offsets and keep whichever maximises the
// entropy contrast — aligns the boundary with the sharpest statistical transition.
const REFINE = 4;
const refineBoundary = (buf, b, prev, next) => {
    let best = b;
    let bestScore = splitContrast(buf, b);
    for (let d = -REFINE; d <= REFINE; d++) {
        const c = b + d;
        if (c <= prev + MIN_CHUNK || c >= next - MIN_CHUNK)
            continue;
        const score = splitContrast(buf, c);
        if (score > bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return best;
};
// Max LFSR order we test during model-stability check.  BM with this cap aborts
// in O(N × L_CAP) time — fast even for large chunks.
const MS_L_CAP = 5;
// Linear complexity of a buffer, using a short window to keep BM O(MS_L_CAP²).
// Running BM on a window of 2*L_CAP+10 bytes is sufficient to confirm L ≤ L_CAP.
const LC_WINDOW = 2 * MS_L_CAP + 10;
const linearComplexity = (buf) => addon_1.addon.bmSolve(Buffer.from(buf.subarray(0, Math.min(buf.length, LC_WINDOW)))).length;
// Recursively split chunks whose linear complexity is too high but where BOTH
// halves individually have low complexity (different models on each side).
// Stops when either half also fails the check (noisy LFSR → keep whole) or
// when the chunk reaches MIN_CHUNK*2.
const modelStableSplit = (buf) => {
    if (buf.length < MIN_CHUNK * 2)
        return [buf];
    if (linearComplexity(buf) <= MS_L_CAP)
        return [buf]; // already fits one model
    const mid = Math.floor(buf.length / 2);
    const lL = linearComplexity(buf.slice(0, mid));
    const rL = linearComplexity(buf.slice(mid));
    // Only split when BOTH halves fit a short LFSR — guards against noisy-LFSR
    // false splits where both halves also look complex due to noise.
    if (lL <= MS_L_CAP && rL <= MS_L_CAP)
        return [...modelStableSplit(buf.slice(0, mid)), ...modelStableSplit(buf.slice(mid))];
    return [buf];
};
// Split at entropy discontinuities.  Scans at half-window steps to catch boundaries
// between windows; min/max chunk size prevents degenerate splits.
// After detection, each boundary is refined by ±4 bytes to snap to the sharpest
// transition point within the neighbourhood.
const adaptiveChunks = (buf) => {
    if (buf.length <= MIN_CHUNK * 2)
        return [buf];
    const rough = [];
    for (let i = WINDOW; i < buf.length - WINDOW; i += WINDOW >> 1) {
        const last = rough.length ? rough[rough.length - 1] : 0;
        const size = i - last;
        if (size >= MAX_CHUNK) {
            rough.push(i);
            continue;
        }
        if (size < MIN_CHUNK)
            continue;
        const before = (0, entropy_1.shannonEntropy)(buf.slice(i - WINDOW, i));
        const after = (0, entropy_1.shannonEntropy)(buf.slice(i, i + WINDOW));
        if (Math.abs(after - before) > DELTA_THRESHOLD)
            rough.push(i);
    }
    // Refine each boundary
    const boundaries = [0];
    for (let k = 0; k < rough.length; k++) {
        const prev = boundaries[boundaries.length - 1];
        const next = k + 1 < rough.length ? rough[k + 1] : buf.length;
        boundaries.push(refineBoundary(buf, rough[k], prev, next));
    }
    boundaries.push(buf.length);
    const entropyChunks = boundaries.slice(0, -1).map((s, idx) => buf.slice(s, boundaries[idx + 1]));
    // Second pass: split chunks that span model boundaries entropy missed
    return entropyChunks.flatMap(modelStableSplit);
};
exports.adaptiveChunks = adaptiveChunks;
