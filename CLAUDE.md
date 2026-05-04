# pade-compress

Math-based compression via Berlekamp-Massey / Padé approximants over GF(2⁸). Targets data with **GF(2⁸) linear recurrence structure** (LFSR/PRBS streams, firmware binaries, telecom payloads). Not a general-purpose compressor.

## Commands

```bash
npm run build          # TypeScript compile → dist/
npm test               # 35 unit tests (vitest)
npm run demo           # Synthetic roundtrip demo
npm run bench <file>   # Benchmark any file (compress + verify, no output written)
npm run compress <in> <out.pade>
npm run decompress <in.pade> <out>
npm run test:file      # Roundtrip test on test/gf-structured.bin
```

## Project layout

```
c/
  gf256.c / gf256.h       GF(2⁸) arithmetic (AES poly, O(1) log/exp tables)
  gf_wide.c / gf_wide.h   GF(2^16) arithmetic (128KB tables, poly 0x1002D)
  bm.c / bm.h             BM algorithm, LFSR run/errors, approx L=1..5
  bm_wide.c / bm_wide.h   BM over GF(2^16), LFSR16 struct, BM16_MAX_L=32
  analyze.c / analyze.h   Buffer structure analysis, segment classification
  addon.c                 N-API bridge: exposes all C functions to Node.js
src/
  native/
    addon.ts              TypeScript interface + require() for the .node addon
  core/
    pade.ts               Thin wrappers over addon: findBestPade, findApproxL1..L5
    entropy.ts            Shannon entropy + compressibility gate
    analysis.ts           Structure detector: analyzeBuffer(), formatAnalysis()
    gf-poly.ts            GF polynomial utilities (+ .test.ts)
  codec/
    encoder.ts            7-path encoding pipeline (calls C via addon)
    decoder.ts            LFSR replay + residual XOR (calls C via addon)
    format.ts             Binary serialization (format v3)
    chunker.ts            Entropy-adaptive chunking (calls C for BM probes)
    stream.ts             Node.js streaming interface
    worker-pool.ts        Worker thread pool
    worker-entry.ts       Worker thread entry point
  utils/
    sparse.ts             Sparse residual encoding (+ .test.ts)
    buffer.ts             Byte utilities
    math.ts               Misc math helpers
  cli.ts                  CLI entry point
scripts/
  gen-gf-file.ts          Generates synthetic GF-structured test binary
test/
  gf-structured.bin       1MB synthetic GF file (L=1/2/3 segments + noise)
examples/
  demo.ts                 Synthetic roundtrip demo
```

## Architecture

**C is the source of truth for all math.** All GF arithmetic, BM, LFSR operations, and approximate LFSR detection (L=1..5) live in `c/`. The Node.js layer calls into C via an N-API addon (`build/Release/pade_compress_addon.node`). TypeScript handles coordination, chunking, wire format, and the CLI only.

**N-API bridge** — `c/addon.c` exposes 8 functions to JS: `bmSolve`, `lfsrRun`, `approxL1`, `approxL1BestOffset`, `approxL2`, `approxL3`, `approxLn`, `analyzeBuffer`. All heavy math (BM, voting, LFSR run) is performed in C; JS receives plain numbers/Buffers.

**Encoding pipeline**
1. **Adaptive chunking** — splits input at entropy discontinuities (BM probe via `addon.bmSolve`)
2. Per chunk: run **Padé [k/L] offset search** (tries offsets 0..32, finds best k + shortest L via BM)
3. If exact BM fails → **approx L=1** (brute-forces 255 GF coefficients in C, O(255·N))
4. If L=1 fails → **approx L=2** (quadruple voting in C, O(N))
5. If L=2 fails → **approx L=3** (quinuple-pair voting in C, O(N))
6. If L=3 fails → **approx L=4,5** (sub-sequence BM voting via `approxLn`, O(N·windows))
7. **Size gate** — emit raw chunk if LFSR representation would be larger

**Wire format** (format v3)
```
File header: [4] magic "PADE" [4] originalSize [4] chunkCount

Raw chunk:   [1] kind=0  [4] dataLen  [N] data

LFSR chunk:  [1] kind=1  [4] origLen  [1] prefixLen  [P] prefix
             [2] lfsrLen L  [L] coefficients  [L] seed bytes
             [1] residual flag: 0=plain sparse  1=deflate-raw
             flag=0: sparse residual bytes
             flag=1: [4] deflatedLen  [D] deflate-raw bytes
```
Residuals = XOR of predicted vs actual bytes. Perfect recurrences → empty residual.

**Key design choices**
- L/N ratio used as compression gate, not Shannon entropy (m-sequences have ~8 bits/byte entropy but L=1)
- BM_MAX_L = 64 hard limit in C; sequences needing L > 64 are treated as unstructured
- Residuals: position-value pairs win at <33% non-zero; otherwise dense

## Programmatic API

```typescript
import { compress, decompress, compressAsync } from "pade-compress"

// Synchronous
const compressed = compress(inputBytes)   // Uint8Array → Uint8Array
const restored   = decompress(compressed) // Uint8Array → Uint8Array

// Async: chunks encoded in parallel across worker threads
const compressed = await compressAsync(inputBytes)
const compressed = await compressAsync(inputBytes, 4) // explicit worker count

// Streaming
import { createCompressStream, createDecompressStream } from "pade-compress"
readable.pipe(createCompressStream()).pipe(writable)
```

## TypeScript config

- Target: ES2022, CommonJS modules, strict mode
- Test files co-located with source (`*.test.ts`) — vitest picks them up automatically
- `tsx` used for running scripts/examples directly without a build step

## Limitations

- Not for text, images, or already-compressed formats — use zstd/brotli there
- Best as a **specialized pipeline stage**: detect algebraic structure → compress here, else fall back to statistical codec
- O(n²) BM is the bottleneck for large high-order LFSR chunks
