"use strict";
// Simple CLI: compress / decompress / bench / analyze a file
// Usage:
//   tsx src/cli.ts compress  <input>  <output.pade>
//   tsx src/cli.ts decompress <input.pade> <output>
//   tsx src/cli.ts bench     <input>               (compress + verify, no output written)
//   tsx src/cli.ts analyze   <input>               (algebraic structure report)
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const zlib_1 = require("zlib");
const index_1 = require("./index");
const entropy_1 = require("./core/entropy");
const analysis_1 = require("./core/analysis");
// Split argv into flags (--foo) and positional args so flags can appear anywhere
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith("--")));
const [cmd, src, dst] = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (!cmd || !src) {
    console.error("usage: tsx src/cli.ts <compress|decompress|bench|analyze> [--json] <input> [output]");
    process.exit(1);
}
const input = (0, fs_1.readFileSync)(src);
const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
if (cmd === "decompress") {
    if (!dst) {
        console.error("decompress requires an output path");
        process.exit(1);
    }
    const out = (0, index_1.decompress)(bytes);
    (0, fs_1.writeFileSync)(dst, out);
    console.log(`decompressed → ${out.length} bytes`);
}
else if (cmd === "compress") {
    if (!dst) {
        console.error("compress requires an output path");
        process.exit(1);
    }
    const t0 = performance.now();
    const file = (0, index_1.encode)(bytes);
    const pade = (0, index_1.serialize)(file);
    const gz = (0, zlib_1.gzipSync)(pade, { level: 9 });
    const out = gz.length < pade.length ? gz : pade;
    const ms = (performance.now() - t0).toFixed(1);
    (0, fs_1.writeFileSync)(dst, out);
    const ratio = ((out.length / bytes.length) * 100).toFixed(1);
    console.log(`${bytes.length} B → ${out.length} B  (${ratio}%)  in ${ms} ms`);
}
else if (cmd === "bench") {
    const t0 = performance.now();
    const file = (0, index_1.encode)(bytes);
    const pade = (0, index_1.serialize)(file);
    const gz = (0, zlib_1.gzipSync)(pade, { level: 9 });
    const compressed = gz.length < pade.length ? gz : pade;
    const t1 = performance.now();
    const restored = (0, index_1.decompress)(compressed);
    const t2 = performance.now();
    const ok = bytes.length === restored.length && bytes.every((b, i) => b === restored[i]);
    const kindCounts = new Map();
    for (const c of file.chunks)
        kindCounts.set(c.kind, (kindCounts.get(c.kind) ?? 0) + 1);
    const kindStr = [...kindCounts.entries()].map(([k, n]) => `${n} ${k}`).join("  ");
    console.log(`\nFile:        ${src}`);
    console.log(`Original:    ${bytes.length.toLocaleString()} bytes`);
    console.log(`Compressed:  ${compressed.length.toLocaleString()} bytes  (${((compressed.length / bytes.length) * 100).toFixed(1)}%)`);
    console.log(`Entropy:     ${(0, entropy_1.shannonEntropy)(bytes).toFixed(2)} bits/byte`);
    console.log(`Chunks:      ${file.chunks.length} total  (${kindStr})`);
    console.log(`Encode:      ${(t1 - t0).toFixed(1)} ms`);
    console.log(`Decode:      ${(t2 - t1).toFixed(1)} ms`);
    console.log(`Lossless:    ${ok ? "✓" : "✗  BUG"}`);
}
else if (cmd === "analyze") {
    const result = (0, analysis_1.analyzeBuffer)(bytes, src);
    console.log(flags.has("--json") ? (0, analysis_1.toJSON)(result) : (0, analysis_1.formatAnalysis)(result));
}
else {
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
}
