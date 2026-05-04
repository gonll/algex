export interface SegmentInfo {
    readonly offset: number;
    readonly length: number;
    readonly kind: "lfsr" | "cyclic" | "raw";
    readonly L: number | null;
    readonly period: number | null;
    readonly coeffs: number[];
    readonly noisePercent: number;
    readonly recognition: string;
    readonly compressedSize: number;
}
export interface AnalysisResult {
    readonly filename: string | null;
    readonly totalBytes: number;
    readonly entropyBitsPerByte: number;
    readonly segments: SegmentInfo[];
    readonly structuredFraction: number;
    readonly linearComplexity: number;
    readonly verdict: string;
}
export declare const analyzeBuffer: (buf: Uint8Array, filename?: string) => AnalysisResult;
export declare const shouldCompress: (buf: Uint8Array) => boolean;
export declare const toJSON: (r: AnalysisResult) => string;
export declare const formatAnalysis: (r: AnalysisResult) => string;
