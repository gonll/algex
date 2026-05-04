"use strict";
// Worker thread entry point for parallel chunk encoding.
// Receives raw chunk bytes, encodes them, returns serialized chunk bytes.
// Imported lazily by worker-pool so the heavy GF tables only load in workers.
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const encoder_1 = require("./encoder");
const format_1 = require("./format");
worker_threads_1.parentPort.on("message", ({ id, buffer }) => {
    const bytes = new Uint8Array(buffer);
    const chunk = (0, encoder_1.encodeChunk)(bytes);
    const serialized = (0, format_1.serializeChunk)(chunk);
    // Transfer the ArrayBuffer back to avoid copying
    worker_threads_1.parentPort.postMessage({ id, serialized: serialized.buffer }, [serialized.buffer]);
});
