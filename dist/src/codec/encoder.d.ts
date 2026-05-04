import { Chunk, CompressedFile } from "../types";
export declare const encodeChunk: (chunk: Uint8Array) => Chunk;
export declare const encode: (buf: Uint8Array) => CompressedFile;
export declare const encodeAsync: (buf: Uint8Array, workers?: number, onProgress?: (done: number, total: number) => void) => Promise<CompressedFile>;
