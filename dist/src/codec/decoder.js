"use strict";
// Decode pipeline: prefix || xorBytes(predicted, residual) per chunk
Object.defineProperty(exports, "__esModule", { value: true });
exports.decode = void 0;
const buffer_1 = require("../utils/buffer");
const addon_1 = require("../native/addon");
const transform_1 = require("../core/transform");
const interleave_1 = require("../utils/interleave");
const bitplane_1 = require("../core/bitplane");
const runLFSR = (lfsr, init, n) => Array.from(addon_1.addon.lfsrRun(lfsr.coeffs, Buffer.from(init), n));
const decodeChunk = (chunk) => {
    if (chunk.kind === "raw")
        return chunk.data;
    if (chunk.kind === "cyclic") {
        const { cycle, originalLength } = chunk;
        const out = new Uint8Array(originalLength);
        for (let i = 0; i < originalLength; i++)
            out[i] = cycle[i % cycle.length];
        return out;
    }
    if (chunk.kind === "delta") {
        const inner = decodeChunk(chunk.inner);
        const dt = transform_1.DELTA_TRANSFORMS.find(d => d.id === chunk.deltaId);
        if (!dt)
            throw new Error(`Unknown delta ID: ${chunk.deltaId}`);
        return dt.invert(inner);
    }
    if (chunk.kind === "affine") {
        const inner = decodeChunk(chunk.inner);
        const out = new Uint8Array(inner.length);
        const k = chunk.k;
        for (let i = 0; i < inner.length; i++)
            out[i] = inner[i] ^ k;
        return out;
    }
    if (chunk.kind === "interleave") {
        const decodedLanes = chunk.lanes.map(l => decodeChunk(l));
        return (0, interleave_1.mergeInterleave)(decodedLanes, chunk.m);
    }
    if (chunk.kind === "bitplane") {
        return (0, bitplane_1.mergeBitplanes)(chunk.planes.map(p => decodeChunk(p)));
    }
    if (chunk.kind === "lfsr16") {
        const { coeffs, seed, residual, originalLength } = chunk;
        const wordCount = originalLength / 2;
        const predicted = addon_1.addon.lfsr16Run(coeffs, Buffer.from(seed), wordCount);
        const predArr = new Uint8Array(predicted.buffer, predicted.byteOffset, predicted.byteLength);
        return (0, buffer_1.xorBytes)(predArr.subarray(0, originalLength), residual);
    }
    const { prefix, lfsr, init, residual, originalLength } = chunk;
    const lfsrRegionLen = originalLength - prefix.length;
    const predicted = (0, buffer_1.fromSeq)(runLFSR(lfsr, init, lfsrRegionLen));
    const lfsrRegion = (0, buffer_1.xorBytes)(predicted, residual);
    return prefix.length === 0 ? lfsrRegion : (0, buffer_1.concatBytes)([prefix, lfsrRegion]);
};
const decode = (file) => (0, buffer_1.concatBytes)(file.chunks.map(decodeChunk));
exports.decode = decode;
