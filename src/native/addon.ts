interface NativeAddon {
  // GF(2^8) — byte-level Berlekamp-Massey and LFSR replay
  bmSolve(buf: Buffer): { length: number; coeffs: number[] }
  lfsrRun(coeffs: number[], seed: Buffer, count: number): Buffer
  approxL1(buf: Buffer): { coeff: number; errCount: number }
  approxL1BestOffset(buf: Buffer, maxOffset: number): { coeff: number; errCount: number }
  approxL2(buf: Buffer): { coeffs: number[]; err: number } | null
  approxL3(buf: Buffer): { coeffs: number[]; err: number } | null
  approxLn(buf: Buffer, targetL: number): { coeffs: number[]; err: number } | null
  analyzeBuffer(buf: Buffer, filename?: string): string

  // GF(2^16) — word-level BM (treats pairs of bytes as uint16 LE elements)
  // bm16Solve: buf must be even-length; returns coeffs as JS numbers (uint16 values)
  bm16Solve(buf: Buffer): { length: number; coeffs: number[] }
  // lfsr16Run: coeffs are uint16 values; seed is uint16-LE Buffer of length L*2;
  //            returns uint16-LE Buffer of length count*2
  lfsr16Run(coeffs: number[], seed: Buffer, count: number): Buffer
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
function loadAddon(): NativeAddon {
  // When bundled with pkg, native .node files can't live inside the snapshot.
  // Convention: ship pade_compress_addon.node alongside the executable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((process as any).pkg !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path")
    const sidecar = path.join(path.dirname(process.execPath), "pade_compress_addon.node")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(sidecar) as NativeAddon
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../build/Release/pade_compress_addon") as NativeAddon
}

export const addon = loadAddon()
