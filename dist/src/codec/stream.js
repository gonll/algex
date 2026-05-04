"use strict";
// Node.js Transform stream wrappers for compress / decompress pipelines.
//
// Usage:
//   import { pipeline } from "stream/promises"
//   await pipeline(fs.createReadStream(src), createCompressStream(), fs.createWriteStream(dst))
//
// The current implementation buffers the full input before flushing — sufficient
// for files that fit in memory.  True chunk-boundary streaming would require
// fixing the chunk size so boundaries can be emitted incrementally.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDecompressStream = exports.createCompressStream = void 0;
const stream_1 = require("stream");
const index_1 = require("../index");
const createCompressStream = () => {
    const parts = [];
    return new stream_1.Transform({
        transform(chunk, _enc, cb) {
            parts.push(chunk);
            cb();
        },
        flush(cb) {
            try {
                this.push(Buffer.from((0, index_1.compress)(new Uint8Array(Buffer.concat(parts)))));
                cb();
            }
            catch (e) {
                cb(e);
            }
        },
    });
};
exports.createCompressStream = createCompressStream;
const createDecompressStream = () => {
    const parts = [];
    return new stream_1.Transform({
        transform(chunk, _enc, cb) {
            parts.push(chunk);
            cb();
        },
        flush(cb) {
            try {
                this.push(Buffer.from((0, index_1.decompress)(new Uint8Array(Buffer.concat(parts)))));
                cb();
            }
            catch (e) {
                cb(e);
            }
        },
    });
};
exports.createDecompressStream = createDecompressStream;
