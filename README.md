# pade-compress

> **Patent Pending** — Argentine Patent Application filed with INPI (Instituto Nacional de la Propiedad Industrial), Nro E-RECAUDA 202600063124, priority date 04/05/2026. International filing under the Paris Convention available until 04/05/2027.

**Algebraic model extractor + residual encoder for GF(2⁸) linear recurrences.**

Runs Berlekamp-Massey / Padé approximants over GF(2⁸) to extract the shortest LFSR that generated a byte stream — then stores only the model and a sparse XOR residual.  Works on data that statistical compressors (gzip, brotli, zstd) are fundamentally blind to.

---

## The one thing this does that nothing else can

Statistical compressors exploit symbol frequencies and repeated byte patterns. They cannot see **algebraic structure**.

A GF(2⁸) m-sequence has ~8 bits/byte Shannon entropy — indistinguishable from white noise by any information-theoretic measure. gzip declares it incompressible and passes it through unchanged. This codec compresses the same data to **1.2%** — an **85:1 ratio** — because it operates in the right domain.

| File | gzip | pade-compress | Ratio |
|------|------|---------------|-------|
| GF(2⁸) geometric sequence (L=1, perfect) | ~100% | **~0.3%** | ~333:1 |
| Mixed LFSR (L=1/2/3 + 8% noise) 1 MB | ~99% | **1.1%** | **91:1** |
| Binary executable (`/bin/ls`) | ~60% | **19.3%** | 5.1:1 |
| Natural language text | ~35% | 100.1% | — |
| WebP image | ~100% | ~100.5% | — |

The win zone is data with **GF(2⁸) linear recurrence structure**. Outside that zone it detects the mismatch quickly and falls through to a raw passthrough with negligible overhead.

---

## Analyze first — compress if it fits

```bash
npm run analyze ./your-prbs-stream.bin
```

```
File:        ./test/gf-structured.bin
Size:        1,048,576 bytes
Entropy:     7.888 bits/byte
Structured:  100.0% algebraic
Avg L:       1.75 (weighted LFSR order)
Verdict:     100% algebraically structured — compresses extremely well (LFSR/PRBS data)
────────────────────────────────────────────────────────────
Segments (11):
  +       0 [ 262,140 B]  PRBS-8 m-sequence (maximal-length, perfect)  noise 0.0%  coeffs [0x03]
  +  262140 [ 262,144 B]  L=2 LFSR (exact, period unknown)              noise 0.0%  coeffs [0x1b,0x4e]
  +  524284 [ 237,249 B]  L=3 LFSR (~2.0% noise)                       noise 2.0%  coeffs [0x57,0x2f,0x11]
  +  786433 [ 131,071 B]  order 85 (period 85)                          noise 0.0%  coeffs [0x07]
  +  917504 [ 131,072 B]  PRBS-8 m-sequence (maximal-length, perfect)  noise 0.0%  coeffs [0xe3]
```

`--analyze` tells you *what algebraic structure is present*, even if you're not planning to compress. The verdict drives the routing decision: structured data → compress here; unstructured data → fall back to zstd/brotli.

---

## How it works

Every byte sequence can be tested: does there exist a short recurrence
`s[i] = c₁·s[i-1] ⊕ c₂·s[i-2] ⊕ … ⊕ cₗ·s[i-L]` over GF(2⁸)?

The **Berlekamp-Massey algorithm** finds the shortest such recurrence (the minimal LFSR) in O(n²). If the LFSR order L is small relative to the sequence length n, storing `(L coefficients + L seed bytes + sparse residual)` is far smaller than the raw bytes.

### Encoding pipeline

```
Input bytes
  │
  ├─ Adaptive chunking  (splits at entropy discontinuities; boundaries refined ±4 bytes)
  │
  └─ Per chunk — 15 encoding paths tried in order:
       ├─  1. Padé [k/L] search  (tries offsets 0..32, finds best k + shortest L)
       ├─  2. Approx L=1  (brute-forces all 255 GF coefficients for noisy L=1 data)
       ├─  3. Approx L=2  (voting over GF quadruples, covers up to ~28% byte noise)
       ├─  4. Approx L=3  (voting over quintuple pairs, covers up to ~23% byte noise)
       ├─  5. Approx L=4,5  (sub-sequence BM voting for higher-order LFSRs)
       ├─  6. Affine L=1  (y[n] = c·y[n-1] ⊕ b via shift normalisation to pure L=1)
       ├─  7. Cyclic  (exact period detection for lookup tables and repeating patterns)
       ├─ 8-10. Delta transforms  (XOR-diff, ADD-diff, XOR-2nd-diff → re-run paths 1-7)
       │        Gated: only attempted when entropy is high AND algebraicity score is low.
       ├─ 11-13. Interleave m=2,3,4  (split byte lanes → encode independently → merge)
       │         Gated: BM pre-screen on each lane to avoid spending time on random data.
       ├─ 14. Bit-plane decomposition  (each of 8 bit planes encoded independently)
       │      Gated: BM pre-screen per plane; useful for ADC/DAC samples and firmware images.
       └─ 15. Raw passthrough  (if no representation is smaller)
```

Each approximate path (2–5) applies **seed denoising** after finding the LFSR polynomial: sweeps all 256 candidate values for each seed byte and picks the one that minimises the total residual, removing systematic init-window errors in O(L×256×N).

**Dual pre-gate** controls whether transform paths 8–14 run at all:
- Gate 1 (entropy): skip if data is already statistically compressible (H < 60% of raw) — text, headers, already-compressed bytes.
- Gate 2 (algebraicity): skip if data is too random-like, measured by BM complexity fluctuation across sliding 16-byte windows. High fluctuation = crypto/noise → transforms won't help.

Only data that is both high-entropy AND algebraically structured reaches paths 8–14. This is precisely the class that benefits from transform-based encoding.

### Wire format (v4)

```
File header:  [4] magic "PAD4"  [4] originalSize  [4] chunkCount

Raw chunk:    [1] kind=0  [4] dataLen  [N] data  [4] CRC32

LFSR chunk:   [1] kind=1  [4] origLen  [1] prefixLen  [P] prefix
              [2] lfsrLen L  [L] coefficients  [L] seed bytes
              [1] residual flag: 0=plain sparse  1=deflate-raw  2=brotli
              [payload]  [4] CRC32

Cyclic chunk: [1] kind=2  [4] origLen  [2] period P  [P] cycle_bytes  [4] CRC32

Delta chunk:  [1] kind=3  [4] origLen  [1] deltaId  [4] innerLen  [inner]  [4] CRC32
Affine chunk: [1] kind=4  [4] origLen  [1] k        [4] innerLen  [inner]  [4] CRC32

Interleave:   [1] kind=5  [4] origLen  [1] m
              m × { [4] laneLen  [lane bytes] }  [4] CRC32

Bitplane:     [1] kind=6  [4] origLen  [1] planeCount (always 8)
              8 × { [4] planeLen  [plane bytes] }  [4] CRC32

EOF sentinel: [1] 0xFE

XDNI index:   [4] "XDNI"  [4] chunkCount  [N×8] entries  [4] indexOffset
              Each entry: [4] chunkOffset  [4] origLen
```

Residuals are XOR of predicted vs actual bytes. Perfect recurrences produce empty residuals. For noisy data the residual is sparse-encoded as delta-compressed position-value pairs, then optionally deflate/brotli compressed — whichever is smallest wins.

---

## Who has this data

This codec targets engineers working with data sources that use shift-register logic. On those payloads it achieves compression that no general-purpose tool can match — because **entropy is not the right measure of compressibility**:

> A 1 MB PRBS stream has ~8 bits/byte Shannon entropy. gzip stores it in ~1 MB. pade-compress stores it in **12 KB**.

- **Hardware test engineers** — PRBS (pseudorandom binary sequence) streams for PCIe, USB, SONET, and Ethernet signal integrity testing are generated by LFSRs. `--analyze` instantly identifies the generator polynomial and noise level.
- **Embedded / firmware teams** — bootloader images, CRC lookup tables, DSP coefficient tables in flash. Binary executables already show 19% compression vs ~60% from gzip.
- **Telecom / networking** — line scramblers in fiber optic links use LFSR-based XOR scrambling; descrambled payloads carry GF structure.
- **Automotive / aerospace** — FlexRay and MIL-STD-1553 use LFSR framing; telemetry from shift-register hardware.
- **Security / cryptanalysis** — `--analyze` can detect if a "random" stream has unexpectedly low LFSR complexity, which is a red flag for weak PRNGs.

---

## Pre-built executables

No Node.js required. Download the archive for your platform from the [GitHub Releases](https://github.com/gonll/algex/releases) page:

| Platform | Archive |
|---|---|
| Windows x64 | `pade-compress-windows-x64.zip` |
| Linux x64 | `pade-compress-linux-x64.tar.gz` |
| macOS ARM64 | `pade-compress-macos-arm64.tar.gz` |

Each archive contains two files that **must stay in the same directory**:

- `pade-compress` (or `pade-compress.exe` on Windows) — self-contained executable
- `pade_compress_addon.node` — native GF/BM library, loaded at runtime as a sidecar

```bash
# Windows
.\pade-compress.exe analyze your-prbs-stream.bin

# Linux / macOS
./pade-compress analyze your-prbs-stream.bin
```

Releases are built automatically by GitHub Actions on every `v*` tag across all three platforms.

---

## Installation (Node.js / npm)

```bash
npm install pade-compress
```

This package includes a native C addon (the GF(2⁸) arithmetic and Berlekamp-Massey core). `npm install` will compile it automatically. You need:

- **macOS**: Xcode Command Line Tools — `xcode-select --install`
- **Linux**: `build-essential` — `sudo apt install build-essential` (Debian/Ubuntu) or equivalent
- **Windows**: [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) or Visual Studio with C++ workload

Node.js ≥ 18 required.

---

## Usage

```bash
# Detect algebraic structure (no compression performed)
npx tsx src/cli.ts analyze <input>

# Compress
npx tsx src/cli.ts compress <input> <output.pade>

# Decompress
npx tsx src/cli.ts decompress <input.pade> <output>

# Benchmark (compress + verify, no output written)
npx tsx src/cli.ts bench <input>

# Shortcuts (analyze and bench are hardcoded to the test file — use the above for other files)
npm run analyze   # runs on ./test/gf-structured.bin
npm run bench     # runs on ./test/gf-structured.bin
```

### Programmatic API

```typescript
import { compress, decompress, compressAsync, analyzeBuffer, formatAnalysis } from "pade-compress"
import type { AnalysisResult, SegmentInfo } from "pade-compress"

// Detect structure without committing to compression
const result = analyzeBuffer(inputBytes, "my-file.bin")
console.log(formatAnalysis(result))
// result.verdict, result.structuredFraction, result.segments[i].recognition …

// Synchronous compression
const compressed = compress(inputBytes)   // Uint8Array → Uint8Array
const restored   = decompress(compressed) // Uint8Array → Uint8Array

// Async (chunks encoded in parallel across worker threads)
const compressed = await compressAsync(inputBytes)
const compressed = await compressAsync(inputBytes, 4) // explicit worker count

// Streaming
import { createCompressStream, createDecompressStream } from "pade-compress"
readable.pipe(createCompressStream()).pipe(writable)
```

---

## Benchmarks

Run on an Apple M-series machine.

```
GF(2⁸) geometric (L=1, perfect)      4 096 B →     ~12 B  (~0.3%)  encode 2ms    decode <1ms
Noisy GF (L=1, 5% errors)            4 096 B →    ~400 B  (~9.8%)  encode 3ms    decode <1ms
Padé offset (16-byte noise prefix)   4 096 B →     ~50 B  (~1.2%)  encode 3ms    decode <1ms
Mixed LFSR (L=1/2/3 + 8% noise) 1 048 576 B →  11 503 B  ( 1.1%)  encode 310ms  decode 30ms
Binary executable (/bin/ls)         154 624 B →  29 875 B  (19.3%) encode 136ms  decode 4ms
Natural language text (/usr/share/dict/words) →  ~100.1%           (no LFSR structure found)
```

Decode is always near-instant — LFSR replay is a tight arithmetic loop with no branching.

---

## Project layout

```
c/
  gf256.c / gf256.h       GF(2⁸) arithmetic (AES poly, O(1) log/exp tables)
  gf_wide.c / gf_wide.h   GF(2^16) arithmetic (128KB tables, poly 0x1002D)
  bm.c / bm.h             BM algorithm, LFSR run/errors, approx L=1..5
  bm_wide.c / bm_wide.h   BM over GF(2^16), BM16_MAX_L=32
  analyze.c / analyze.h   Buffer analysis, segment classification, PRBS recognition
  addon.c                 N-API bridge: exposes all C math to Node.js
src/
  native/
    addon.ts              TypeScript interface for the compiled .node addon
  core/
    pade.ts               Thin wrappers: findBestPade, findApproxL1..L5, findApproxAffineL1
    entropy.ts            Shannon entropy + compressibility gate
    transform.ts          Dual pre-gate (entropy + algebraicity score), delta transforms
    analysis.ts           analyzeBuffer(), formatAnalysis()
    bitplane.ts           splitBitplanes / mergeBitplanes (8-plane decomposition)
    gf-poly.ts            GF polynomial utilities: factorRoots, polyFromRoots (+ .test.ts)
  codec/
    encoder.ts            15-path encoding pipeline
    decoder.ts            LFSR replay + residual XOR; cyclic/interleave/bitplane decode
    format.ts             Binary serialization (format v4: PAD4, CRC32, XDNI index)
    chunker.ts            Entropy-adaptive chunking with ±4 boundary refinement (+ .test.ts)
    stream.ts             Node.js streaming interface
    worker-pool.ts        Worker thread pool for parallel chunk encoding
    worker-entry.ts       Worker thread entry point
  utils/
    sparse.ts             Sparse residual encoding (empty / pairs / dense) (+ .test.ts)
    buffer.ts             Byte utilities
    math.ts               Misc math helpers
scripts/
  gen-gf-file.ts          Generates a synthetic GF-structured test binary
test/
  gf-structured.bin       1MB synthetic GF file (L=1/2/3 segments + noise)
examples/
  demo.ts                 Synthetic roundtrip demo
```

---

## Architecture decisions

**GF(2⁸) not GF(257)** — All 256 byte values are native field elements. Addition is XOR. Multiplication uses AES irreducible polynomial (x⁸+x⁴+x³+x+1) with O(1) log/exp tables.

**Entropy ≠ compressibility** — GF(2⁸) m-sequences have ~8 bits/byte entropy (near-maximum) but LFSR length = 1. The compression gate uses L/N ratio, not entropy.

**Padé [k/L] offset search** — Tries offsets 0..32 before running the full LFSR search. Handles data with a non-algebraic header (file magic bytes, salts) before a regular algebraic body. Breaks early if offset=0 already fails — incompressible data is detected in one BM pass.

**Approximate L=1 fallback** — For noisy data where exact BM finds a very long LFSR, brute-forces all 255 GF coefficients in O(255·N) and picks the one with the sparsest residual. Covers up to ~17% byte noise.

**Approximate L=2 fallback** — Votes across consecutive GF quadruples in O(N) to find the dominant (c1, c2) pair. Majority threshold 25%; verification threshold `1−(1−T)^3`. Covers up to ~28% byte noise.

**Approximate L=3 fallback** — Two-stage: votes on (c2, c3) via paired quintuple equations, then votes on c1 given the (c2, c3) anchor. Voting threshold 20%; verification threshold `1−(1−T)^4`. Covers up to ~23% byte noise.

**Approximate L=4,5 via sub-sequence BM voting** — Runs BM on many short overlapping windows (length 2L+4). The true polynomial wins a plurality across windows even when individual windows contain errors. Generalises to arbitrary L with no increase in code complexity.

**Affine L=1 detection** — Recognises sequences `y[n] = c·y[n-1] ⊕ b` by voting on the ratio `(y[i]⊕y[i+1]) / (y[i-1]⊕y[i])` over consecutive triples — a formula that cancels the additive constant b and is stable under noise. Once c and b are known, the shift `k = b·inv(1⊕c)` transforms the sequence into a pure multiplicative recurrence.

**Seed denoising** — After any approximate LFSR search (L=1..5), the first L seed bytes may themselves be noise. For each seed position in turn, sweeps all 256 candidate values and picks the one minimising total prediction errors across the whole sequence. O(L×256×N) — fast, and turns what would be dense residuals at the start of a chunk into clean LFSR predictions.

**Noisy-init offset search** — If the first L bytes of a chunk happen to be noise, the LFSR prediction diverges immediately. The approximate paths probe offsets 1..8 and store the noisy prefix verbatim, finding a clean seed window.

**Cyclic / exact period encoding** — For data with exact period P (lookup tables, counter arrays, repeating test patterns), stores a single cycle. Runs after all LFSR paths so geometric sequences still use the smaller LFSR form.

**Delta transforms** — XOR-first-difference, ADD-first-difference (mod 256), and XOR-second-difference are tried on chunks that pass the dual pre-gate. ADD-diff catches counter sequences that are linear over integers but not over GF(2⁸). Each is fully invertible; the transform ID is stored in the wire format.

**Interleave m=2,3,4** — Splits a byte stream into m lanes (bytes 0,m,2m,… / 1,m+1,2m+1,… / …) and encodes each independently. Useful when even-byte and odd-byte lanes carry different LFSR generators. A short BM complexity pre-screen (cap=5, window=20) skips non-LFSR lanes cheaply before committing to full encoding.

**Bit-plane decomposition** — Splits each byte into its 8 bit planes (bit b of every input byte → plane b). Each plane is encoded independently as a 0/1 byte sequence. Useful when different bit planes carry distinct linear structures — ADC/DAC samples (MSB planes carry magnitude patterns, LSBs are noisier), firmware images (opcode MSBs periodic, operand LSBs random). Same BM pre-screen gate as interleave.

**Dual pre-gate** — Transform paths 8–14 are gated by two fast checks before any expensive work: (1) entropy gate rejects already-statistically-compressible data (huffman estimate < 60% of raw); (2) algebraicity gate rejects random-like data by measuring how consistently BM complexity behaves across sliding 16-byte windows. Only data that is simultaneously high-entropy and algebraically structured reaches the transform paths.

**Wire format v4 (PAD4)** — Adds per-chunk CRC32, an EOF sentinel byte, and an XDNI index trailer (chunk offsets + original lengths) for O(1) random-access seek to any chunk. All chunk kinds use the same CRC placement (4 bytes after the chunk payload).

**Polynomial factoring** — `gf-poly.ts` provides the full round-trip: `factorRoots` decomposes an LFSR minimal polynomial into its GF(2⁸) roots (when they're all distinct); `polyFromRoots` reconstructs the polynomial from roots via ∏(x + αᵢ). Together they enable inspecting whether a higher-order LFSR is a sum of independent geometric sequences.

**Boundary refinement** — After detecting entropy discontinuities, each candidate split point is tried at ±4-byte offsets and the one with the sharpest entropy contrast is kept. Aligns chunk boundaries with the true algebraic transition rather than the nearest scan position.

**Worker thread pool** — `compressAsync` distributes chunks across a pool of worker threads (defaults to `availableParallelism()`). Falls back to synchronous encoding if workers can't initialise.

**Sparse + deflate residuals** — Non-zero residual bytes are encoded as delta-compressed position-value pairs. For a chunk with 350 errors scattered across 4 096 bytes the average gap is ~12, meaning 75% of the uint32 gap bytes are zero — the resulting packed block compresses from ~1 KB down to ~50 bytes under deflate-9.

**PRBS recognition** — The `--analyze` output identifies degree-1 LFSRs whose coefficient has multiplicative order 255 (primitive elements → PRBS-8 m-sequences, period 255). Other periods (85, 51, 17, 15, 5, 3, 1) are named by their order in GF(2⁸)*.

---

## Limitations

- Not a general-purpose compressor. Use zstd/brotli for text, images, and already-compressed formats.
- Best used as a **specialized stage in a pipeline**: `analyzeBuffer()` first; if `structuredFraction > 0.5` compress here, otherwise fall back to a statistical codec.
- O(n²) Berlekamp-Massey is the bottleneck for large chunks with high LFSR order.

---

## Development

```bash
npm run build                          # TypeScript compile + native addon
npm test                               # 121 unit tests across 7 test files
npm run demo                           # Synthetic roundtrip demo
npx tsx src/cli.ts bench <file>        # Benchmark any file
npx tsx src/cli.ts analyze <file>      # Algebraic structure report
npm run build:exe                      # Build a self-contained executable for the current platform
```

### Building executables locally

`npm run build:exe` compiles TypeScript, rebuilds the native addon, and bundles the CLI into a single executable via [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg). The resulting binary + `pade_compress_addon.node` sidecar land in `executables/`. Both files are required together.

To produce all three platform targets from a single machine you need to cross-compile the native addon (non-trivial). The recommended path is to push a `v*` tag and let GitHub Actions build each platform natively:

```bash
git tag v0.1.2 && git push origin v0.1.2
```

This triggers `.github/workflows/release.yml`, which builds on `windows-latest`, `ubuntu-latest`, and `macos-latest` and publishes all three archives to the GitHub release automatically.

121 tests across 7 test files covering sparse encoding, Padé search (via C addon), GF polynomial round-trips, approximate LFSR detection (L=1..5), chunking with boundary refinement, dual pre-gate (entropy + algebraicity), and end-to-end roundtrips.
