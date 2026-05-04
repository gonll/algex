export type ResidualKind = 0 | 1 | 2 | 3 | 4;
export declare const packResidual: (residual: Uint8Array) => Uint8Array;
export declare const packedResidualSize: (residual: Uint8Array) => number;
export declare const unpackResidual: (buf: Uint8Array, off: number, lfsrRegionLen: number) => [Uint8Array, number];
