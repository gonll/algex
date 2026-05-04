export declare const toSeq: (buf: Uint8Array) => number[];
export declare const fromSeq: (seq: number[]) => Uint8Array;
export declare const xorBytes: (a: Uint8Array, b: Uint8Array) => Uint8Array;
export declare const concatBytes: (parts: Uint8Array[]) => Uint8Array;
export declare const isAllZero: (buf: Uint8Array) => boolean;
