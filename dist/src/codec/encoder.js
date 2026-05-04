"use strict";
// Encode pipeline (16 paths):
//   0. GF(2^16) BM (even-length chunks — word-level recurrences in 16-bit streams)
//   1. Exact Padé [k/L] offset BM
//   2. Approx L=1 (brute-force 255 GF coefficients)
//   3. Approx L=2 (quadruple voting, covers ~28% noise)
//   4. Approx L=3 (quintuple-pair voting, covers ~23% noise)
//   5. Approx L=4,5 (sub-sequence BM voting for higher-order LFSRs)
//   6. Affine L=1 (y[n] = c*y[n-1] ^ b via shift normalization)
//   7. Cyclic / exact period detection
//   8-10. Delta transforms: XOR diff, ADD diff, XOR 2nd diff (high-entropy gate)
//   11-13. Interleave m=2,3,4 (high-entropy gate, BM pre-screen per lane)
//   14. Bitplane (high-entropy gate, BM pre-screen per plane)
//   15. Raw passthrough
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeAsync = exports.encode = exports.encodeChunk = void 0;
const buffer_1 = require("../utils/buffer");
const entropy_1 = require("../core/entropy");
const pade_1 = require("../core/pade");
const transform_1 = require("../core/transform");
const interleave_1 = require("../utils/interleave");
const bitplane_1 = require("../core/bitplane");
const chunker_1 = require("./chunker");
const format_1 = require("./format");
const addon_1 = require("../native/addon");
const runLFSR = (lfsr, init, n) => Array.from(addon_1.addon.lfsrRun(lfsr.coeffs, Buffer.from(init), n));
const rawSize = (n) => 1 + 4 + n;
// After an approximate search finds LFSR coefficients, check whether each seed byte
// looks clean by probing a short window of predictions. If a seed position appears
// noisy (its single-byte error propagates obviously), sweep all 256 candidates for
// that position and pick the one that minimises total residual errors.
//
// Skips chunks above DENOISE_MAX and seed positions that are already clean —
// keeping O(L×256×N) work confined to the rare case where it's actually needed.
const DENOISE_MAX = 512; // beyond this, 256×L×N cost dominates for marginal gain
const denoiseSeed = (seq, coeffs, init) => {
    if (seq.length > DENOISE_MAX)
        return init;
    const L = coeffs.length;
    const lfsr = { coeffs, length: L };
    const PROBE = Math.min(4 * L + 8, seq.length);
    const probe = runLFSR(lfsr, init, PROBE);
    let probeErrors = 0;
    for (let i = 0; i < PROBE; i++)
        if (probe[i] !== seq[i])
            probeErrors++;
    if (probeErrors / PROBE < 0.02)
        return init;
    const best = [...init];
    for (let pos = 0; pos < L; pos++) {
        let bestErrors = Infinity;
        let bestVal = best[pos];
        for (let v = 0; v < 256; v++) {
            best[pos] = v;
            const pred = runLFSR(lfsr, best, seq.length);
            let errors = 0;
            for (let i = 0; i < seq.length; i++) {
                if (pred[i] !== seq[i])
                    errors++;
                if (errors >= bestErrors)
                    break;
            }
            if (errors < bestErrors) {
                bestErrors = errors;
                bestVal = v;
            }
        }
        best[pos] = bestVal;
    }
    return best;
};
// Detect exact periodicity: find the smallest P such that s[i] = s[i mod P] everywhere.
// Returns the single cycle (P bytes) or null.  Only checks P ≤ max(512, n/2).
const detectCyclic = (seq) => {
    const n = seq.length;
    const maxP = Math.min(512, Math.floor(n / 2));
    outer: for (let P = 1; P <= maxP; P++) {
        for (let i = P; i < n; i++) {
            if (seq[i] !== seq[i % P])
                continue outer;
        }
        return Uint8Array.from(seq.slice(0, P));
    }
    return null;
};
const buildLFSRChunk = (chunk, seq, offset, lfsr, init) => {
    const prefix = Uint8Array.from(seq.slice(0, offset));
    const lfsrRegion = seq.slice(offset);
    const predicted = (0, buffer_1.fromSeq)(runLFSR(lfsr, init, lfsrRegion.length));
    const actualBytes = Uint8Array.from(lfsrRegion);
    const residual = (0, buffer_1.xorBytes)(actualBytes, predicted);
    return { kind: "lfsr", prefix, lfsr, init, residual, originalLength: chunk.length };
};
// Try offsets 0..maxOff for an approximate finder; return the best-scoring LFSRChunk
// or null if no offset beats rawSize.
const encodeApproxWithOffset = (find, seq, chunk, L) => {
    const result0 = find(seq);
    if (!result0)
        return null;
    const cand0 = buildLFSRChunk(chunk, seq, 0, result0.lfsr, result0.init);
    const size0 = (0, pade_1.refinedSize)(0, L, cand0.residual);
    const rSize = rawSize(chunk.length);
    if (size0 < rSize)
        return cand0;
    const maxOff = Math.min(8, seq.length - L - 2);
    let best = cand0;
    let bestSize = size0;
    for (let off = 1; off <= maxOff; off++) {
        const result = find(seq.slice(off));
        if (!result)
            continue;
        const candidate = buildLFSRChunk(chunk, seq, off, result.lfsr, result.init);
        const size = (0, pade_1.refinedSize)(off, L, candidate.residual);
        if (size < bestSize) {
            bestSize = size;
            best = candidate;
        }
        if (bestSize < rSize)
            break;
    }
    return bestSize < rSize ? best : null;
};
// Rough wire-size estimate for a simple chunk, without running deflate.
const estimateSimpleBytes = (c) => {
    if (c.kind === "raw")
        return 1 + 4 + c.data.length;
    if (c.kind === "cyclic")
        return 1 + 4 + 2 + c.cycle.length;
    return (0, pade_1.refinedSize)(c.prefix.length, c.lfsr.length, c.residual);
};
// Rough wire-size estimate for any NonDeltaChunk (used to evaluate delta wrappers).
const estimateNonDeltaBytes = (c) => {
    if (c.kind === "raw" || c.kind === "cyclic" || c.kind === "lfsr")
        return estimateSimpleBytes(c);
    if (c.kind === "lfsr16") {
        const L16 = c.coeffs.length;
        const nonZero = c.residual.filter(b => b !== 0).length;
        const resBytes = nonZero * 2 < c.residual.length ? nonZero * 2 + 1 : c.residual.length + 1;
        return 1 + 4 + 1 + L16 * 4 + resBytes;
    }
    if (c.kind === "affine")
        return 1 + 4 + 1 + 4 + estimateSimpleBytes(c.inner);
    if (c.kind === "interleave")
        return 1 + 4 + 1 + c.lanes.reduce((s, l) => s + 4 + estimateSimpleBytes(l), 0);
    // bitplane
    return 1 + 4 + 1 + c.planes.reduce((s, p) => s + 4 + estimateSimpleBytes(p), 0);
};
const withDenoise = (r, sub) => {
    const needsDenoise = sub.length <= DENOISE_MAX && r.nonZeroCount / sub.length > 0.05;
    return { lfsr: r.lfsr, init: needsDenoise ? denoiseSeed(sub, r.lfsr.coeffs, r.init) : r.init };
};
// ── searchLFSR: paths 1-5 (exact + approx L=1..5) ────────────────────────────
//
// Shared by both encodeChunkCore and encodeChunk to avoid duplicating these
// five paths in two places.
const searchLFSR = (chunk, seq) => {
    const { offset, lfsr, init } = (0, pade_1.findBestPade)(seq);
    if ((0, entropy_1.isCompressible)(chunk, lfsr.length)) {
        const candidate = buildLFSRChunk(chunk, seq, offset, lfsr, init);
        if ((0, pade_1.refinedSize)(offset, lfsr.length, candidate.residual) < rawSize(chunk.length))
            return candidate;
    }
    return (encodeApproxWithOffset(sub => { const r = (0, pade_1.findApproxL1)(sub); return r ? withDenoise(r, sub) : null; }, seq, chunk, 1) ??
        encodeApproxWithOffset(sub => { const r = (0, pade_1.findApproxL2)(sub); return r ? withDenoise(r, sub) : null; }, seq, chunk, 2) ??
        encodeApproxWithOffset(sub => { const r = (0, pade_1.findApproxL3)(sub); return r ? withDenoise(r, sub) : null; }, seq, chunk, 3) ??
        encodeApproxWithOffset(sub => { const r = (0, pade_1.findApproxL4)(sub); return r ? withDenoise(r, sub) : null; }, seq, chunk, 4) ??
        encodeApproxWithOffset(sub => { const r = (0, pade_1.findApproxL5)(sub); return r ? withDenoise(r, sub) : null; }, seq, chunk, 5) ??
        null);
};
// ── tryLFSR16: GF(2^16) path (path 0) ────────────────────────────────────────
//
// Treats byte pairs as uint16 LE elements and runs BM over GF(2^16).
// Useful for 16-bit ADC/DAC streams where the word-level recurrence is shorter
// than the byte-level one found by GF(2^8) BM.  Even-length chunks only.
const tryLFSR16 = (chunk) => {
    if (chunk.length % 2 !== 0 || chunk.length < 8)
        return null;
    const buf = Buffer.from(chunk);
    const result = addon_1.addon.bm16Solve(buf);
    const L16 = result.length;
    if (L16 === 0 || L16 > 32 || L16 * 4 >= chunk.length)
        return null;
    const wordCount = chunk.length / 2;
    const seedBuf = buf.slice(0, L16 * 2);
    const predicted = addon_1.addon.lfsr16Run(result.coeffs, seedBuf, wordCount);
    const predArr = new Uint8Array(predicted.buffer, predicted.byteOffset, predicted.byteLength);
    const residual = new Uint8Array(chunk.length);
    let nonZero = 0;
    for (let i = 0; i < chunk.length; i++) {
        residual[i] = chunk[i] ^ predArr[i];
        if (residual[i] !== 0)
            nonZero++;
    }
    const resBytes = nonZero * 2 < chunk.length ? nonZero * 2 + 1 : chunk.length + 1;
    const wireSize = 1 + 4 + 1 + L16 * 4 + resBytes;
    if (wireSize >= rawSize(chunk.length))
        return null;
    return { kind: "lfsr16", coeffs: result.coeffs, seed: Uint8Array.from(seedBuf), residual, originalLength: chunk.length };
};
// ── encodeChunkCore: structural paths only (LFSR + cyclic) ───────────────────
//
// Used when encoding transformed or interleaved/bitplane sub-sequences where
// wrapper overhead is already accounted for by the caller.
const encodeChunkCore = (chunk) => {
    const seq = (0, buffer_1.toSeq)(chunk);
    const lfsr = searchLFSR(chunk, seq);
    if (lfsr)
        return lfsr;
    const cycle = detectCyclic(seq);
    if (cycle !== null && 1 + 4 + 2 + cycle.length < rawSize(chunk.length))
        return { kind: "cyclic", cycle, originalLength: chunk.length };
    return { kind: "raw", data: chunk };
};
// ── encodeChunkInner: all non-delta paths ─────────────────────────────────────
//
// Used as the inner encoder for delta wrappers (depth-2 compositions like
// delta(affine), delta(interleave), delta(lfsr16)).  Excludes delta itself
// to prevent useless delta-of-delta nesting.
const encodeChunkInner = (chunk) => {
    const seq = (0, buffer_1.toSeq)(chunk);
    const rSize = rawSize(chunk.length);
    // GF(2^8) paths first — preferred for byte-structured data (firmware, PRBS streams).
    // GF(2^16) is a fallback for word-level recurrences (ADC/DAC, 16-bit samples).
    const lfsr = searchLFSR(chunk, seq);
    if (lfsr)
        return lfsr;
    const lfsr16 = tryLFSR16(chunk);
    if (lfsr16)
        return lfsr16;
    const affineResult = tryAffine(chunk, seq);
    if (affineResult)
        return { kind: "affine", k: affineResult.k, inner: affineResult.inner, originalLength: chunk.length };
    const cycle = detectCyclic(seq);
    if (cycle !== null && 1 + 4 + 2 + cycle.length < rSize)
        return { kind: "cyclic", cycle, originalLength: chunk.length };
    if ((0, transform_1.shouldTryTransforms)(chunk)) {
        const INTERLEAVE_OVERHEAD = 6;
        const BITPLANE_OVERHEAD = 6;
        for (const m of [2, 3, 4]) {
            const lanes = (0, interleave_1.splitInterleave)(chunk, m);
            if (!lanes.every(laneIsStructured))
                continue;
            const encodedLanes = lanes.map(encodeChunkCore);
            if (!encodedLanes.some(l => l.kind !== "raw"))
                continue;
            const laneBytes = encodedLanes.reduce((s, l) => s + 4 + estimateSimpleBytes(l), 0);
            if (INTERLEAVE_OVERHEAD + laneBytes < rSize)
                return { kind: "interleave", m, lanes: encodedLanes, originalLength: chunk.length };
        }
        const planes = (0, bitplane_1.splitBitplanes)(chunk);
        if (planes.every(laneIsStructured)) {
            const encodedPlanes = planes.map(encodeChunkCore);
            if (encodedPlanes.some(p => p.kind !== "raw")) {
                const planeBytes = encodedPlanes.reduce((s, p) => s + 4 + estimateSimpleBytes(p), 0);
                if (BITPLANE_OVERHEAD + planeBytes < rSize)
                    return { kind: "bitplane", planes: encodedPlanes, originalLength: chunk.length };
            }
        }
    }
    return { kind: "raw", data: chunk };
};
const tryAffine = (chunk, seq) => {
    const r = (0, pade_1.findApproxAffineL1)(seq);
    if (!r)
        return null;
    const shifted = seq.map(v => v ^ r.k);
    const inner = buildLFSRChunk(chunk, shifted, 0, r.lfsr, r.init);
    const totalBytes = 1 + 4 + 1 + 4 + estimateSimpleBytes(inner);
    if (totalBytes >= rawSize(chunk.length))
        return null;
    return { k: r.k, inner };
};
// Short BM window used as a cheap gate before running full lane/plane encoding.
const BM_GATE_WINDOW = 20;
const BM_GATE_CAP = 5;
const laneIsStructured = (lane) => {
    if (lane.length < 4)
        return false;
    return addon_1.addon.bmSolve(Buffer.from(lane.subarray(0, Math.min(lane.length, BM_GATE_WINDOW)))).length <= BM_GATE_CAP;
};
const encodeChunk = (chunk) => {
    const rSize = rawSize(chunk.length);
    // ── Paths 0-7: structural paths (GF16, GF8 LFSR, affine, cyclic) + interleave/bitplane ──
    const core = encodeChunkInner(chunk);
    if (core.kind !== "raw")
        return core;
    // ── Paths 8-10: delta transforms (high-entropy + algebraic gate) ──
    // Applied BEFORE interleave/bitplane to match original pipeline ordering.
    // Inner encoding uses encodeChunkInner (not encodeChunkCore) to enable depth-2
    // compositions: delta(affine), delta(lfsr16), delta(interleave), delta(bitplane).
    if ((0, transform_1.shouldTryTransforms)(chunk)) {
        const DELTA_OVERHEAD = 10; // kind(1) + origLen(4) + deltaId(1) + innerLen(4)
        for (const dt of transform_1.DELTA_TRANSFORMS) {
            const transformed = dt.apply(chunk);
            const inner = encodeChunkInner(transformed);
            if (inner.kind === "raw")
                continue;
            if (DELTA_OVERHEAD + estimateNonDeltaBytes(inner) < rSize)
                return { kind: "delta", deltaId: dt.id, inner, originalLength: chunk.length };
        }
    }
    return core; // raw fallback
};
exports.encodeChunk = encodeChunk;
// Merge adjacent LFSR chunks that share identical coefficients and a continuous LFSR
// state (end-state of chunk N equals init of chunk N+1).  Eliminates per-chunk header
// overhead for long homogeneous segments, which can dominate for small chunks.
const concatUint8 = (a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
};
const coeffsMatch = (a, b) => {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a.coeffs[i] !== b.coeffs[i])
            return false;
    return true;
};
const mergeCompatibleChunks = (chunks) => {
    const result = [];
    let i = 0;
    while (i < chunks.length) {
        const curr = chunks[i];
        if (curr.kind !== "lfsr") {
            result.push(curr);
            i++;
            continue;
        }
        const L = curr.lfsr.length;
        const regionLen = curr.originalLength - curr.prefix.length;
        let endState = runLFSR(curr.lfsr, curr.init, regionLen).slice(-L);
        let merged = curr;
        let j = i + 1;
        while (j < chunks.length) {
            const next = chunks[j];
            if (next.kind !== "lfsr")
                break;
            if (!coeffsMatch(merged.lfsr, next.lfsr))
                break;
            if (next.prefix.length > 0)
                break;
            const continuation = runLFSR(merged.lfsr, endState, 2 * L).slice(L);
            let continuous = true;
            for (let k = 0; k < L; k++) {
                if (continuation[k] !== next.init[k]) {
                    continuous = false;
                    break;
                }
            }
            if (!continuous)
                break;
            const nextRegionLen = next.originalLength;
            endState = runLFSR(next.lfsr, next.init, nextRegionLen).slice(-L);
            merged = {
                kind: "lfsr",
                prefix: merged.prefix,
                lfsr: merged.lfsr,
                init: merged.init,
                residual: concatUint8(merged.residual, next.residual),
                originalLength: merged.originalLength + next.originalLength,
            };
            j++;
        }
        result.push(merged);
        i = j;
    }
    return result;
};
// Synchronous encode: all chunks in the calling thread
const encode = (buf) => ({
    chunks: mergeCompatibleChunks((0, chunker_1.adaptiveChunks)(buf).map(exports.encodeChunk)),
    originalSize: buf.length,
});
exports.encode = encode;
// Async encode: chunks distributed across a worker thread pool for parallelism.
// Falls back to synchronous if workers fail to initialise (e.g. no tsx loader).
const encodeAsync = async (buf, workers, onProgress) => {
    const chunks = (0, chunker_1.adaptiveChunks)(buf);
    const total = chunks.length;
    let pool = null;
    try {
        const { WorkerPool } = await Promise.resolve().then(() => __importStar(require("./worker-pool")));
        pool = new WorkerPool(workers);
    }
    catch {
        return (0, exports.encode)(buf);
    }
    try {
        let done = 0;
        const serializedChunks = await Promise.all(chunks.map(async (chunk) => {
            const copy = new Uint8Array(chunk);
            const result = await pool.encode(copy.buffer);
            onProgress?.(++done, total);
            return result;
        }));
        return {
            chunks: mergeCompatibleChunks(serializedChunks.map(ab => (0, format_1.deserializeChunk)(new Uint8Array(ab)))),
            originalSize: buf.length,
        };
    }
    finally {
        await pool.terminate();
    }
};
exports.encodeAsync = encodeAsync;
