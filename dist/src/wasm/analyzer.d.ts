import type { AnalysisResult } from "../core/analysis";
/** Returns true only when dist/wasm/analyzer.js exists and loads successfully. */
export declare const isWasmAvailable: () => Promise<boolean>;
/**
 * Analyse a buffer using the compiled C analyzer via WASM.
 *
 * Allocates WASM heap memory, copies `buf` in, calls `_analyze_buffer` and
 * `_print_analysis_json`, parses the JSON result, then frees WASM memory.
 *
 * @throws {Error} If the WASM module is not available (run `npm run build:wasm`).
 */
export declare const analyzeBufferWasm: (buf: Uint8Array, filename?: string) => Promise<AnalysisResult>;
