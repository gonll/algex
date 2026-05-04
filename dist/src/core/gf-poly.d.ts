import { GFElem, LFSR } from "../types";
export declare const evalPoly: (p: GFElem[], x: GFElem) => GFElem;
export declare const lfsrMinPoly: ({ coeffs, length }: LFSR) => GFElem[];
export declare const findRoots: (p: GFElem[]) => GFElem[];
export declare const polyFromRoots: (roots: GFElem[]) => GFElem[];
export declare const factorRoots: (lfsr: LFSR) => GFElem[] | null;
