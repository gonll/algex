import { LFSR, GFElem } from "../types";
export declare const berlekampMassey: (s: GFElem[], maxL?: number) => LFSR;
export declare const runLFSR: (lfsr: LFSR, init: GFElem[], n: number) => GFElem[];
