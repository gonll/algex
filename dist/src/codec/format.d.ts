import { CompressedFile, Chunk } from "../types";
export declare const serialize: (file: CompressedFile) => Uint8Array;
export declare const serializeChunk: (chunk: Chunk) => Uint8Array;
export declare const deserializeChunk: (buf: Uint8Array) => Chunk;
export declare const readChunkAt: (buf: Uint8Array, chunkIndex: number) => Chunk | null;
export declare const deserialize: (buf: Uint8Array) => CompressedFile;
export declare function streamDeserialize(buf: Uint8Array): Iterable<Chunk>;
