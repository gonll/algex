"use strict";
// Public API — compress/decompress bytes and optionally inspect the internals
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerPool = exports.shouldCompress = exports.toJSON = exports.formatAnalysis = exports.analyzeBuffer = exports.createDecompressStream = exports.createCompressStream = exports.readChunkAt = exports.streamDeserialize = exports.deserialize = exports.serialize = exports.decode = exports.encodeAsync = exports.encode = exports.compressAsync = exports.decompress = exports.compress = void 0;
const zlib_1 = require("zlib");
const encoder_1 = require("./codec/encoder");
Object.defineProperty(exports, "encode", { enumerable: true, get: function () { return encoder_1.encode; } });
Object.defineProperty(exports, "encodeAsync", { enumerable: true, get: function () { return encoder_1.encodeAsync; } });
const decoder_1 = require("./codec/decoder");
Object.defineProperty(exports, "decode", { enumerable: true, get: function () { return decoder_1.decode; } });
const format_1 = require("./codec/format");
Object.defineProperty(exports, "serialize", { enumerable: true, get: function () { return format_1.serialize; } });
Object.defineProperty(exports, "deserialize", { enumerable: true, get: function () { return format_1.deserialize; } });
// Tries gzip on the structural pade output and returns whichever is smaller.
// Incompressible raw chunks produce pade bytes that gzip can't shrink further,
// so the original is returned to avoid paying the ~18-byte gzip header tax.
const smallerOfGzip = (pade) => {
    const gz = (0, zlib_1.gzipSync)(pade, { level: 9 });
    return gz.length < pade.length ? gz : pade;
};
// Synchronous full pipeline: structural GF(2^8/16) encoding → gzip wrapper if it helps.
// Output may be gzip-wrapped (.pade inside gzip) or raw .pade — decompress() handles both.
const compress = (input) => smallerOfGzip((0, format_1.serialize)((0, encoder_1.encode)(input)));
exports.compress = compress;
// Decompresses output from compress() or compressAsync().
// Auto-detects gzip wrapper (magic bytes 1f 8b) and falls back to raw PAD4 format.
const decompress = (input) => {
    const pade = (input[0] === 0x1f && input[1] === 0x8b) ? (0, zlib_1.gunzipSync)(input) : input;
    return (0, decoder_1.decode)((0, format_1.deserialize)(pade));
};
exports.decompress = decompress;
// Async full pipeline: chunks encoded in parallel across worker threads.
// onProgress is called after each chunk completes with (doneCount, totalCount).
const compressAsync = async (input, workers, onProgress) => smallerOfGzip((0, format_1.serialize)(await (0, encoder_1.encodeAsync)(input, workers, onProgress)));
exports.compressAsync = compressAsync;
var format_2 = require("./codec/format");
Object.defineProperty(exports, "streamDeserialize", { enumerable: true, get: function () { return format_2.streamDeserialize; } });
Object.defineProperty(exports, "readChunkAt", { enumerable: true, get: function () { return format_2.readChunkAt; } });
var stream_1 = require("./codec/stream");
Object.defineProperty(exports, "createCompressStream", { enumerable: true, get: function () { return stream_1.createCompressStream; } });
Object.defineProperty(exports, "createDecompressStream", { enumerable: true, get: function () { return stream_1.createDecompressStream; } });
var analysis_1 = require("./core/analysis");
Object.defineProperty(exports, "analyzeBuffer", { enumerable: true, get: function () { return analysis_1.analyzeBuffer; } });
Object.defineProperty(exports, "formatAnalysis", { enumerable: true, get: function () { return analysis_1.formatAnalysis; } });
Object.defineProperty(exports, "toJSON", { enumerable: true, get: function () { return analysis_1.toJSON; } });
Object.defineProperty(exports, "shouldCompress", { enumerable: true, get: function () { return analysis_1.shouldCompress; } });
var worker_pool_1 = require("./codec/worker-pool");
Object.defineProperty(exports, "WorkerPool", { enumerable: true, get: function () { return worker_pool_1.WorkerPool; } });
