// WASM wrapper for the C algebraic-structure analyzer.
//
// Build the WASM module first with:
//   npm run build:wasm
//
// This compiles c/gf256.c, c/bm.c, and c/analyze.c via Emscripten (emcc) into
// dist/wasm/analyzer.js + dist/wasm/analyzer.wasm. Emscripten must be installed;
// see https://emscripten.org/docs/getting_started/downloads.html
//
// If the WASM file is not present, isWasmAvailable() returns false and
// analyzeBufferWasm() throws a descriptive error rather than crashing.

import type { AnalysisResult } from "../core/analysis"

// Lazily loaded Emscripten module instance. null = not yet attempted.
// false = attempted but failed (file missing or load error).
let wasmModule: any = null

const loadWasm = async (): Promise<any | null> => {
  if (wasmModule !== null) return wasmModule === false ? null : wasmModule
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module only exists after `npm run build:wasm`
    const { default: create } = await import("../../dist/wasm/analyzer.js")
    const mod = await create()
    mod._gf256_init()
    wasmModule = mod
    return mod
  } catch {
    wasmModule = false
    return null
  }
}

/** Returns true only when dist/wasm/analyzer.js exists and loads successfully. */
export const isWasmAvailable = async (): Promise<boolean> => (await loadWasm()) !== null

/**
 * Analyse a buffer using the compiled C analyzer via WASM.
 *
 * Allocates WASM heap memory, copies `buf` in, calls `_analyze_buffer` and
 * `_print_analysis_json`, parses the JSON result, then frees WASM memory.
 *
 * @throws {Error} If the WASM module is not available (run `npm run build:wasm`).
 */
export const analyzeBufferWasm = async (
  buf: Uint8Array,
  filename?: string
): Promise<AnalysisResult> => {
  const mod = await loadWasm()
  if (!mod) {
    throw new Error(
      "WASM module not available. Run `npm run build:wasm` to compile it (requires Emscripten)."
    )
  }

  const n = buf.length

  // Allocate WASM heap: input buffer + output struct (AnalysisResult is ~16 KB max)
  const bufPtr = mod._malloc(n)
  if (!bufPtr) throw new Error("WASM malloc failed for input buffer")

  // Copy input bytes into WASM heap
  mod.HEAPU8.set(buf, bufPtr)

  // Allocate AnalysisResult struct — use a generous fixed size; the C struct is ~32 KB
  const RESULT_SIZE = 65536
  const resultPtr = mod._malloc(RESULT_SIZE)
  if (!resultPtr) {
    mod._free(bufPtr)
    throw new Error("WASM malloc failed for AnalysisResult struct")
  }

  // Zero the result struct so unset fields are deterministic
  mod.HEAPU8.fill(0, resultPtr, resultPtr + RESULT_SIZE)

  // Allocate and write the filename string if provided
  let filenamePtr = 0
  if (filename) {
    const encoded = new TextEncoder().encode(filename + "\0")
    filenamePtr = mod._malloc(encoded.length)
    if (filenamePtr) mod.HEAPU8.set(encoded, filenamePtr)
  }

  try {
    // Call: void analyze_buffer(const uint8_t *buf, size_t n, const char *filename, AnalysisResult *out)
    mod._analyze_buffer(bufPtr, n, filenamePtr, resultPtr)

    // Capture JSON output by temporarily redirecting stdout via ccall of print_analysis_json.
    // Emscripten prints to stdout; we intercept via Module.print before the call.
    const lines: string[] = []
    const origPrint = mod.print
    mod.print = (line: string) => lines.push(line)
    try {
      mod._print_analysis_json(resultPtr)
    } finally {
      mod.print = origPrint
    }

    const json = lines.join("\n")
    const raw = JSON.parse(json) as {
      file: string
      totalBytes: number
      entropy: number
      structuredFraction: number
      avgL: number
      verdict: string
      segments: Array<{
        offset: number
        length: number
        kind: string
        L: number | null
        noisePct: number
        recognition: string
        coeffs: number[]
      }>
    }

    const result: AnalysisResult = {
      filename:            raw.file || filename || null,
      totalBytes:          raw.totalBytes,
      entropyBitsPerByte:  raw.entropy,
      segments:            raw.segments.map(s => ({
        offset:        s.offset,
        length:        s.length,
        kind:          s.kind as "lfsr" | "cyclic" | "raw",
        L:             s.L,
        period:        null,
        coeffs:        s.coeffs ?? [],
        noisePercent:  s.noisePct,
        recognition:   s.recognition,
        compressedSize: 0,
      })),
      structuredFraction:  raw.structuredFraction,
      linearComplexity:    raw.avgL,
      verdict:             raw.verdict,
    }

    return result
  } finally {
    mod._free(bufPtr)
    mod._free(resultPtr)
    if (filenamePtr) mod._free(filenamePtr)
  }
}
