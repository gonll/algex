export type GFElem = number;
export interface LFSR {
    readonly coeffs: GFElem[];
    readonly length: number;
}
export interface LFSRChunk {
    readonly kind: "lfsr";
    readonly prefix: Uint8Array;
    readonly lfsr: LFSR;
    readonly init: GFElem[];
    readonly residual: Uint8Array;
    readonly originalLength: number;
}
export interface RawChunk {
    readonly kind: "raw";
    readonly data: Uint8Array;
}
export interface CyclicChunk {
    readonly kind: "cyclic";
    readonly cycle: Uint8Array;
    readonly originalLength: number;
}
export type SimpleChunk = LFSRChunk | RawChunk | CyclicChunk;
export interface LFSR16Chunk {
    readonly kind: "lfsr16";
    readonly coeffs: number[];
    readonly seed: Uint8Array;
    readonly residual: Uint8Array;
    readonly originalLength: number;
}
export interface DeltaChunk {
    readonly kind: "delta";
    readonly deltaId: number;
    readonly inner: NonDeltaChunk;
    readonly originalLength: number;
}
export type NonDeltaChunk = SimpleChunk | LFSR16Chunk | AffineChunk | InterleaveChunk | BitplaneChunk;
export interface AffineChunk {
    readonly kind: "affine";
    readonly k: number;
    readonly inner: LFSRChunk;
    readonly originalLength: number;
}
export interface InterleaveChunk {
    readonly kind: "interleave";
    readonly m: number;
    readonly lanes: SimpleChunk[];
    readonly originalLength: number;
}
export interface BitplaneChunk {
    readonly kind: "bitplane";
    readonly planes: SimpleChunk[];
    readonly originalLength: number;
}
export type Chunk = SimpleChunk | LFSR16Chunk | DeltaChunk | AffineChunk | InterleaveChunk | BitplaneChunk;
export interface CompressedFile {
    readonly chunks: Chunk[];
    readonly originalSize: number;
}
