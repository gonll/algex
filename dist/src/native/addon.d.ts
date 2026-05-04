interface NativeAddon {
    bmSolve(buf: Buffer): {
        length: number;
        coeffs: number[];
    };
    lfsrRun(coeffs: number[], seed: Buffer, count: number): Buffer;
    approxL1(buf: Buffer): {
        coeff: number;
        errCount: number;
    };
    approxL1BestOffset(buf: Buffer, maxOffset: number): {
        coeff: number;
        errCount: number;
    };
    approxL2(buf: Buffer): {
        coeffs: number[];
        err: number;
    } | null;
    approxL3(buf: Buffer): {
        coeffs: number[];
        err: number;
    } | null;
    approxLn(buf: Buffer, targetL: number): {
        coeffs: number[];
        err: number;
    } | null;
    analyzeBuffer(buf: Buffer, filename?: string): string;
    bm16Solve(buf: Buffer): {
        length: number;
        coeffs: number[];
    };
    lfsr16Run(coeffs: number[], seed: Buffer, count: number): Buffer;
}
export declare const addon: NativeAddon;
export {};
