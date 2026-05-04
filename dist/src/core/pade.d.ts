import { LFSR, GFElem } from "../types";
export interface PadeResult {
    readonly offset: number;
    readonly lfsr: LFSR;
    readonly init: GFElem[];
}
export declare const refinedSize: (offset: number, L: number, residual: Uint8Array) => number;
export declare const findBestPade: (seq: GFElem[], maxOffset?: number, maxL?: number) => PadeResult;
export interface ApproxL1 {
    readonly lfsr: LFSR;
    readonly init: GFElem[];
    readonly nonZeroCount: number;
}
export declare const findApproxL1: (seq: GFElem[], sparsityThreshold?: number) => ApproxL1 | null;
export interface ApproxL2 {
    readonly lfsr: LFSR;
    readonly init: GFElem[];
    readonly nonZeroCount: number;
}
export declare const findApproxL2: (seq: GFElem[], sparsityThreshold?: number) => ApproxL2 | null;
export interface ApproxL3 {
    readonly lfsr: LFSR;
    readonly init: GFElem[];
    readonly nonZeroCount: number;
}
export declare const findApproxL3: (seq: GFElem[], sparsityThreshold?: number) => ApproxL3 | null;
export interface ApproxLN {
    readonly lfsr: LFSR;
    readonly init: GFElem[];
    readonly nonZeroCount: number;
}
export declare const findApproxLN: (seq: GFElem[], targetL: number, sparsityThreshold?: number) => ApproxLN | null;
export declare const findApproxL4: (seq: GFElem[], sparsityThreshold?: number) => ApproxLN | null;
export declare const findApproxL5: (seq: GFElem[], sparsityThreshold?: number) => ApproxLN | null;
export interface AffineL1Result {
    readonly c: number;
    readonly k: number;
    readonly lfsr: LFSR;
    readonly init: GFElem[];
    readonly nonZeroCount: number;
}
export declare const findApproxAffineL1: (seq: GFElem[], sparsityThreshold?: number) => AffineL1Result | null;
