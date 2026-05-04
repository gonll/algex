"use strict";
// Algebraic structure analysis — inspects a buffer segment-by-segment and
// reports what GF(2^8) recurrence was found, noise level, and whether the
// polynomial matches a known PRBS standard.
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAnalysis = exports.toJSON = exports.shouldCompress = exports.analyzeBuffer = void 0;
const encoder_1 = require("../codec/encoder");
const entropy_1 = require("./entropy");
const gf256_1 = require("../utils/gf256");
const addon_1 = require("../native/addon");
// Human-readable name for a degree-1 LFSR coefficient.
// gfOrder is imported from gf256 — divisors of 255: 1,3,5,15,17,51,85,255.
const describeL1Coeff = (c) => {
    const ord = (0, gf256_1.gfOrder)(c);
    const primitiveOrds = {
        255: "primitive (α, period 255 → PRBS-8 m-sequence)",
        85: "order 85 (period 85)",
        51: "order 51 (period 51)",
        17: "order 17 (period 17)",
        15: "order 15 (period 15)",
        5: "order 5  (period 5)",
        3: "order 3  (period 3)",
        1: "identity (constant sequence)",
    };
    return primitiveOrds[ord] ?? `order ${ord} (period ${ord})`;
};
// Named patterns for higher-order LFSRs (key = hex coefficients joined by comma).
// Covers common scramblers, CRC-split representations, and standard PRBS generators.
const NAMED_POLYS = {
    // Ethernet / SONET / SDH x^7+x^6+1 byte-packed as L=1 after CRC stripping → L=1 handled above
    // ITU-T O.150 PRBS-9 / PRBS-11 byte-mapped representatives
    "01,01": "Fibonacci L=2 (x²+x+1 — min poly, period 3)",
    "01,02": "L=2 near-Fibonacci",
    // CRC-16 (IBM) characteristic: x^16+x^15+x^2+1 split into two GF(2^8) coefficients
    "80,05": "CRC-16/IBM characteristic polynomial split",
    // CRC-CCITT (x^16+x^12+x^5+1)
    "10,21": "CRC-CCITT characteristic polynomial split",
    // AES MixColumns L=4 diffusion polynomial x^4+x+1 over GF(2^8)
    "00,00,00,03": "AES MixColumns minimal polynomial",
    // Galois LFSR variants commonly used in hardware test
    "1b,4e": "L=2 GF test sequence",
    "57,2f": "L=2 GF test sequence (variant)",
    "57,2f,11": "L=3 GF test sequence",
};
const describeHigherOrder = (coeffs, noisePercent) => {
    if (coeffs.length === 0)
        return "L=0 trivial (constant zero sequence)";
    const key = coeffs.map(c => c.toString(16).padStart(2, "0")).join(",");
    if (NAMED_POLYS[key]) {
        const noise = noisePercent < 1 ? "exact" : `~${noisePercent.toFixed(1)}% noise`;
        return `${NAMED_POLYS[key]} (${noise})`;
    }
    // Heuristic: if the constant term (last coeff) is a primitive element (order 255),
    // the characteristic polynomial may be primitive → potentially maximal-length sequence.
    const constantTerm = coeffs[coeffs.length - 1];
    const L = coeffs.length;
    const isPrimitiveLead = (0, gf256_1.gfOrder)(constantTerm) === 255;
    const noiseStr = noisePercent < 1 ? "exact" : `~${noisePercent.toFixed(1)}% noise`;
    const periodHint = isPrimitiveLead
        ? `, possibly maximal-length (period ~2^${8 * L}−1)`
        : "";
    return `L=${L} LFSR (${noiseStr}${periodHint})`;
};
// ── Internal helpers ──────────────────────────────────────────────────────────
const classifySegment = (chunk, offset) => {
    if (chunk.kind === "cyclic") {
        const P = chunk.cycle.length;
        return {
            offset,
            length: chunk.originalLength,
            kind: "cyclic",
            L: null,
            period: P,
            coeffs: [],
            noisePercent: 0,
            recognition: `exact period ${P} (lookup table / repeating pattern)`,
            compressedSize: 7 + P, // 1 kind + 4 origLen + 2 period + P bytes
        };
    }
    // kind === "lfsr"
    const { lfsr, residual, originalLength, prefix } = chunk;
    const L = lfsr.length;
    const noisePercent = originalLength > 0
        ? (residual.filter(b => b !== 0).length / (originalLength - prefix.length)) * 100
        : 0;
    // LFSR period: for L=1 it's ord(c1); for L>1 we don't compute it cheaply — report null
    const period = L === 1 ? (0, gf256_1.gfOrder)(lfsr.coeffs[0]) : null;
    // Recognition string
    let recognition = "";
    if (L === 1) {
        recognition = describeL1Coeff(lfsr.coeffs[0]);
        if ((0, gf256_1.gfOrder)(lfsr.coeffs[0]) === 255) {
            recognition = noisePercent < 1 ? "PRBS-8 m-sequence (maximal-length, perfect)"
                : `PRBS-8 m-sequence (~${noisePercent.toFixed(1)}% noise)`;
        }
    }
    else {
        recognition = describeHigherOrder(lfsr.coeffs, noisePercent);
    }
    // Rough wire size: prefix + lfsr header + residual
    const compressedSize = 1 + 4 + 1 + prefix.length + 2 + L + L + 1 + residual.length;
    return {
        offset,
        length: originalLength,
        kind: "lfsr",
        L,
        period,
        coeffs: [...lfsr.coeffs],
        noisePercent,
        recognition,
        compressedSize,
    };
};
const describeTransformChunk = (chunk) => {
    if (chunk.kind === "lfsr16") {
        const L16 = chunk.coeffs.length;
        const nonZero = chunk.residual.filter(b => b !== 0).length;
        const noise = chunk.originalLength > 0 ? (nonZero / chunk.originalLength) * 100 : 0;
        return { recognition: `GF(2^16) LFSR L=${L16}`, noisePercent: parseFloat(noise.toFixed(1)) };
    }
    if (chunk.kind === "delta") {
        const labels = { 3: "XOR-diff", 4: "ADD-diff", 5: "XOR-2nd-diff" };
        const label = labels[chunk.deltaId] ?? `delta#${chunk.deltaId}`;
        return { recognition: `${label}(${chunk.inner.kind})`, noisePercent: 0 };
    }
    if (chunk.kind === "affine") {
        const k = chunk.k.toString(16).padStart(2, "0");
        return { recognition: `affine L=1 k=0x${k}`, noisePercent: 0 };
    }
    if (chunk.kind === "interleave") {
        const kinds = chunk.lanes.map(l => l.kind).join(",");
        return { recognition: `${chunk.m}-way interleave [${kinds}]`, noisePercent: 0 };
    }
    // bitplane
    const kinds = chunk.planes.map(p => p.kind).join(",");
    return { recognition: `bitplane [${kinds}]`, noisePercent: 0 };
};
// ── Public API ────────────────────────────────────────────────────────────────
const analyzeBuffer = (buf, filename) => {
    const file = (0, encoder_1.encode)(buf);
    const entropy = (0, entropy_1.shannonEntropy)(buf);
    let offset = 0;
    let structBytes = 0;
    let lcSum = 0; // Σ L * length for weighted average
    const segments = [];
    for (const chunk of file.chunks) {
        if (chunk.kind === "raw") {
            segments.push({
                offset,
                length: chunk.data.length,
                kind: "raw",
                L: null,
                period: null,
                coeffs: [],
                noisePercent: 100,
                recognition: "no algebraic structure detected",
                compressedSize: 1 + 4 + chunk.data.length,
            });
            offset += chunk.data.length;
            continue;
        }
        if (chunk.kind !== "lfsr" && chunk.kind !== "cyclic") {
            const len = chunk.originalLength;
            const { recognition, noisePercent } = describeTransformChunk(chunk);
            segments.push({
                offset, length: len, kind: "lfsr", L: null, period: null,
                coeffs: [], noisePercent, recognition,
                compressedSize: len,
            });
            structBytes += len;
            offset += len;
            continue;
        }
        const seg = classifySegment(chunk, offset);
        segments.push(seg);
        structBytes += seg.length;
        if (seg.L !== null)
            lcSum += seg.L * seg.length;
        offset += seg.length;
    }
    const structuredFraction = buf.length > 0 ? structBytes / buf.length : 0;
    const linearComplexity = structBytes > 0 ? lcSum / structBytes : 0;
    // One-line verdict
    const pct = (structuredFraction * 100).toFixed(0);
    const verdict = structuredFraction >= 0.9
        ? `${pct}% algebraically structured — compresses extremely well (LFSR/PRBS data)`
        : structuredFraction >= 0.5
            ? `${pct}% algebraic structure — mixed LFSR + unstructured regions`
            : structuredFraction > 0
                ? `Mostly unstructured (only ${pct}% algebraic) — statistical codec will perform better`
                : `No GF(2^8) linear recurrence detected — use gzip/brotli/zstd`;
    return {
        filename: filename ?? null,
        totalBytes: buf.length,
        entropyBitsPerByte: entropy,
        segments,
        structuredFraction,
        linearComplexity,
        verdict,
    };
};
exports.analyzeBuffer = analyzeBuffer;
// Quick heuristic: is it worth running the full encoder on this buffer?
// Returns true when either a BM probe on a 256-byte sample finds short LFSR structure
// (L/N ≤ 25%) or Shannon entropy is below 6 bits/byte.
const shouldCompress = (buf) => {
    if (buf.length < 4)
        return false;
    const probe = buf.subarray(0, Math.min(buf.length, 256));
    const { length: L } = addon_1.addon.bmSolve(Buffer.from(probe));
    if (L / probe.length <= 0.25)
        return true;
    return (0, entropy_1.shannonEntropy)(buf) < 6.0;
};
exports.shouldCompress = shouldCompress;
// Machine-readable JSON report — schema matches the C analyzer's --json output.
const toJSON = (r) => JSON.stringify({
    file: r.filename ?? undefined,
    totalBytes: r.totalBytes,
    entropy: parseFloat(r.entropyBitsPerByte.toFixed(4)),
    structuredFraction: parseFloat(r.structuredFraction.toFixed(4)),
    avgL: parseFloat(r.linearComplexity.toFixed(2)),
    verdict: r.verdict,
    segments: r.segments.map(s => ({
        offset: s.offset,
        length: s.length,
        kind: s.kind,
        ...(s.kind === "lfsr" ? {
            L: s.L,
            noisePct: parseFloat(s.noisePercent.toFixed(2)),
            recognition: s.recognition,
            coeffs: s.coeffs,
        } : {
            recognition: s.recognition,
        }),
    })),
}, null, 2);
exports.toJSON = toJSON;
// Human-readable report for CLI output.
const formatAnalysis = (r) => {
    const lines = [];
    const sep = "─".repeat(60);
    if (r.filename)
        lines.push(`File:        ${r.filename}`);
    lines.push(`Size:        ${r.totalBytes.toLocaleString()} bytes`);
    lines.push(`Entropy:     ${r.entropyBitsPerByte.toFixed(3)} bits/byte`);
    lines.push(`Structured:  ${(r.structuredFraction * 100).toFixed(1)}% algebraic`);
    if (r.structuredFraction > 0)
        lines.push(`Avg L:       ${r.linearComplexity.toFixed(2)} (weighted LFSR order)`);
    lines.push(`Verdict:     ${r.verdict}`);
    lines.push(sep);
    lines.push(`Segments (${r.segments.length}):`);
    for (const s of r.segments) {
        const loc = `+${s.offset.toString().padStart(8)} [${s.length.toLocaleString().padStart(8)} B]`;
        const noise = s.kind === "lfsr" ? `  noise ${s.noisePercent.toFixed(1)}%` : "";
        const coeffStr = s.coeffs.length > 0
            ? `  coeffs [${s.coeffs.slice(0, 4).map(c => `0x${c.toString(16).padStart(2, "0")}`).join(",")}${s.coeffs.length > 4 ? ",…" : ""}]`
            : "";
        lines.push(`  ${loc}  ${s.recognition}${noise}${coeffStr}`);
    }
    return lines.join("\n");
};
exports.formatAnalysis = formatAnalysis;
