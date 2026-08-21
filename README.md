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
| GF(2⁸) geometric sequence (L=1, perfect) | ~100% | **~1.2%** | ~84:1 |
| Mixed LFSR (L=1/2/3 + 8% noise) 1 MB | ~99% | **1.0%** | **~103:1** |
| Binary executable (`/bin/ls`) | ~60% | **19.3%** | 5.1:1 |
| Natural language text | ~35% | 100.1% | — |
| WebP image | ~100% | ~100.5% | — |

The win zone is data with **GF(2⁸) linear recurrence structure**. Outside that zone it detects the mismatch quickly and falls through to a raw passthrough with negligible overhead.

**Validated against real telecom test patterns, not just synthetic fixtures.** Generated the actual ITU-T O.150 PRBS7/15/23/31 bit-serial sequences used by real SONET/SDH/USB/PCIe conformance test equipment (byte-packed, the way BERT hardware would store them) and mixed them with slices of real compiled binaries. The codec recovers the *exact* GF(256) order (7/15/23/31) matching each PRBS's true bit-level LFSR order, and beats brotli-11 outright: **42.6%** vs brotli-11's **62.5%** on the real PRBS alone, **45.7%** vs **52.1%** on the full mixed real-world corpus. See `scripts/gen-real-world-file.ts` / `scripts/bench-real-world.ts`.

---

## Analyze first — compress if it fits

```bash
npm run analyze ./your-prbs-stream.bin
```

```
File:        test/gf-structured.bin
Size:        1,048,576 bytes
Entropy:     7.888 bits/byte
Structured:  100.0% algebraic
Avg L:       1.75 (weighted LFSR order)
Verdict:     100% algebraically structured — compresses extremely well (LFSR/PRBS data)
────────────────────────────────────────────────────────────
Segments (11):
  +       0 [ 262,140 B]  PRBS-8 m-sequence (maximal-length, perfect)  noise 0.0%  coeffs [0x03]
  +  262140 [ 262,144 B]  L=2 GF test sequence (exact)  noise 0.0%  coeffs [0x1b,0x4e]
  +  524284 [  28,679 B]  L=3 GF test sequence (~1.9% noise)  noise 1.9%  coeffs [0x57,0x2f,0x11]
  +  552963 [  24,570 B]  L=3 GF test sequence (~2.0% noise)  noise 2.0%  coeffs [0x57,0x2f,0x11]
  +  577533 [  20,484 B]  L=3 GF test sequence (~2.2% noise)  noise 2.2%  coeffs [0x57,0x2f,0x11]
  +  598017 [  49,148 B]  L=3 GF test sequence (~2.0% noise)  noise 2.0%  coeffs [0x57,0x2f,0x11]
  +  647165 [  86,023 B]  L=3 GF test sequence (~2.1% noise)  noise 2.1%  coeffs [0x57,0x2f,0x11]
  +  733188 [  28,665 B]  L=3 GF test sequence (~1.9% noise)  noise 1.9%  coeffs [0x57,0x2f,0x11]
  +  761853 [  24,580 B]  L=3 GF test sequence (~1.7% noise)  noise 1.7%  coeffs [0x57,0x2f,0x11]
  +  786433 [ 131,071 B]  order 85 (period 85)  noise 0.0%  coeffs [0x07]
  +  917504 [ 131,072 B]  PRBS-8 m-sequence (maximal-length, perfect)  noise 0.0%  coeffs [0xe3]
```

(This is `npx tsx src/cli.ts analyze` — the TypeScript analyzer, which adaptively re-chunks the noisy L=3 region into several sub-chunks as part of its own model-aware splitting. The separate native `c/gf-analyze` tool, run via `npm run analyze:c` or as part of `npm run test:file`, uses a different fixed-window segmentation and reports the same file as 5 broader segments — both are correct for what each tool measures, they just draw chunk boundaries differently.)

`--analyze` tells you *what algebraic structure is present*, even if you're not planning to compress. The verdict drives the routing decision: structured data → compress here; unstructured data → fall back to zstd/brotli.

---

## How it works

Every byte sequence can be tested: does there exist a short recurrence
`s[i] = c₁·s[i-1] ⊕ c₂·s[i-2] ⊕ … ⊕ cₗ·s[i-L]` over GF(2⁸)?

The **Berlekamp-Massey algorithm** finds the shortest such recurrence (the minimal LFSR) in O(n²). If the LFSR order L is small relative to the sequence length n, storing `(L coefficients + L seed bytes + sparse residual)` is far smaller than the raw bytes.

### Encoding pipeline

Every candidate representation below is generated and scored by a cheap
estimate first; only the top few finalists are actually serialized (including
their real deflate/brotli-compressed residual size), and the smallest **actual**
wire size wins — not the first representation that merely beats raw. This
matters because, e.g., an LFSR fit and an exact-cyclic fit can both "beat raw"
for the same bytes while differing 20%+ in final size.

```
Input bytes
  │
  ├─ Entropy chunking  (splits at entropy discontinuities; boundaries refined ±4 bytes)
  │
  ├─ Model-aware split  (per entropy chunk, 3-stage funnel: cheap model-distance scan
  │  across the chunk → cheap whole-buffer cost re-rank of the best candidates →
  │  only the top few pay for actual serialized-size verification. Only commits to a
  │  split when it's a measured win — replaces blind midpoint bisection.)
  │
  └─ Per chunk — candidates generated, then the smallest actual wire size wins:
       ├─  Padé [k/L] search  (tries offsets 0..32, finds best k + shortest L)
       ├─  Approx L=1..5  (brute-force / voting / sub-sequence BM — covers ~17-28% byte noise)
       │   (skipped once an exact fit at order ≤5 is already found — it can't be beaten;
       │   the ladder itself is also skipped when a cheap multi-window BM probe finds no
       │   plausible low-order fit anywhere in the chunk, even under noise)
       ├─  GF(2^16) word-level BM  (for 16-bit ADC/DAC/audio samples)
       ├─  Affine L=1  (y[n] = c·y[n-1] ⊕ b via shift normalisation to pure L=1)
       ├─  Cyclic  (exact period detection for lookup tables and repeating patterns)
       ├─  Approximate cyclic  (period + sparse residual, majority-vote template —
       │   only tried when exact cyclic fails; handles "ABCABCXBCABCABC"-style noise)
       ├─  Delta transforms  (XOR-diff, ADD-diff, XOR-2nd-diff, re-run against the paths above)
       │        Gated: only attempted when entropy is high AND algebraicity score is low.
       ├─  Interleave m=2,3,4  (split byte lanes → encode independently → merge;
       │   each lane may itself be delta-wrapped if that reveals structure, e.g. a counter lane)
       ├─  Bit-plane decomposition  (each of 8 bit planes encoded independently, same delta option)
       │      Gated: BM pre-screen per plane; useful for ADC/DAC samples and firmware images.
       └─  Raw passthrough  (kept as a candidate throughout, wins if nothing else does)

Adjacent LFSR-model-aware-split pieces that share one entropy-chunk origin are also
tried as a single "switching-LFSR" envelope (one CRC/index entry instead of several),
kept only when that's actually smaller than encoding them as separate chunks.

A deterministic search-budget cost model (fast / balanced / max) caps how many
expensive candidates, transform-depth levels, model solves, and boundary checks run
per chunk — same output bytes regardless of scheduling, threaded through both the
sync and worker-thread-parallel encode paths.
```

Each approximate path applies **seed denoising** after finding the LFSR polynomial: sweeps all 256 candidate values for each seed byte and picks the one that minimises the total residual, removing systematic init-window errors in O(L×256×N).

**Sparse residuals** compete across several encodings, not just one — interleaved position/value pairs (VarInt-delta), split position/value streams, and Rice/Golomb bit-packed positions all get tried, and whichever compresses smallest (after deflate/brotli) is kept.

**Repeated LFSR models** (the same coefficients recurring later in the file, with unrelated data in between) get deduplicated into a file-level model table when the arithmetic says it saves bytes — chunks then store a 2-byte model reference instead of repeating the coefficients.

**Dual pre-gate** controls whether the delta/interleave/bitplane transform paths run at all:
- Gate 1 (entropy): skip if data is already statistically compressible (H < 60% of raw) — text, headers, already-compressed bytes.
- Gate 2 (algebraicity): skip if data is too random-like, measured by BM complexity fluctuation across sliding 16-byte windows. High fluctuation = crypto/noise → transforms won't help.

Only data that is both high-entropy AND algebraically structured reaches the transform paths. This is precisely the class that benefits from transform-based encoding.

### Wire format (v4 / v5)

```
File header:  [4] magic "PAD4" or "PAD5"  [4] originalSize  [4] chunkCount
              PAD5 only: [2] modelCount  modelCount × { [2] L  [L] coeffs }

Raw chunk:       [1] kind=0  [4] dataLen  [N] data  [4] CRC32

LFSR chunk:      [1] kind=1  [4] origLen  [1] prefixLen  [P] prefix
                 [2] lfsrLen L  [L] coefficients  [L] seed bytes
                 [1] residual flag: 0=plain sparse  1=deflate-raw  2=brotli
                 [payload]  [4] CRC32

Cyclic chunk:    [1] kind=2  [4] origLen  [2] period P  [P] cycle_bytes  [4] CRC32

Delta chunk:     [1] kind=3  [4] origLen  [1] deltaId  [4] innerLen  [inner]  [4] CRC32
Affine chunk:    [1] kind=4  [4] origLen  [1] k        [4] innerLen  [inner]  [4] CRC32

Interleave:      [1] kind=5  [4] origLen  [1] m
                 m × { [4] laneLen  [lane bytes] }  [4] CRC32   (a lane may itself be a delta chunk)

Bitplane:        [1] kind=6  [4] origLen  [1] planeCount (always 8)
                 8 × { [4] planeLen  [plane bytes] }  [4] CRC32   (a plane may itself be a delta chunk)

LFSR16 chunk:    [1] kind=7  [4] origLen  [1] L16  [L16×2] coeffs (uint16 LE)
                 [L16×2] seed (uint16 LE)  [1] residual flag  [payload]  [4] CRC32

ApproxCyclic:    [1] kind=8  [4] origLen  [2] period P  [P] cycle
                 [1] residual flag  [payload]  [4] CRC32

LFSRRef (PAD5):  [1] kind=9  [4] origLen  [1] prefixLen  [P] prefix
                 [2] modelId  [L] seed bytes  [1] residual flag  [payload]  [4] CRC32
                 (L looked up from the model table — same layout as an LFSR chunk
                 minus the inline coefficients)

Switching-LFSR:  [1] kind=10  [4] origLen  [2] segmentCount
                 segmentCount × { [4] segmentLen  [2] lfsrLen L  [L] coefficients
                 [L] seed bytes  [1] residual flag  [payload] }  [4] CRC32
                 (bundles several adjacent same-origin LFSR segments — that shared
                 model-aware-split parent — into one envelope, avoiding repeated
                 per-chunk framing; only chosen when it's actually smaller)

EOF sentinel: [1] 0xFE

XDNI index:   [4] "XDNI"  [4] chunkCount  [N×8] entries  [4] indexOffset
              Each entry: [4] chunkOffset  [4] origLen
```

Residuals are XOR of predicted vs actual bytes. Perfect recurrences produce empty residuals. Noisy residuals compete across seven sparse encodings — dense fallback, uint16/uint32 position-value pairs, VarInt-delta pairs, split position/value streams, Rice/Golomb bit-packed positions, a plain bitmap (one bit per byte + a dense value stream, kind=7), and run-length-coded alternating zero/non-zero runs (kind=8) — and whichever wins is then optionally deflate/brotli compressed on top, again picking whichever is smallest.

The outermost wrapper is also a competition: raw PAD bytes vs a cheap tier (zstd where the runtime has it, else gzip — both self-describing) vs max-quality (11) brotli (marker-byte prefixed, since brotli has no self-describing magic), whichever comes out smallest. This runs once per file (not per chunk), so it can afford the highest brotli quality setting without a multiplicative cost — except in `"fast"` mode, which skips brotli entirely and relies on the cheap tier alone (see below).

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

Node.js ≥ 18 required. Node 22.15+ additionally unlocks zstd as the outer wrapper's cheap tier (feature-detected automatically); older Node falls back to gzip there with no other change in behavior.

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

# Shortcuts — same commands, run via npm scripts (still take an explicit input path)
npm run analyze ./your-prbs-stream.bin
npm run bench ./your-prbs-stream.bin
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

// mode: "balanced" (default) | "fast" | "max" — controls both the algebraic
// search budget AND the outer wrap. "fast" skips the expensive brotli-11
// pass and relies on zstd/gzip alone, so it's genuinely fast end-to-end, not
// just a smaller search — real-world testing measured ~45% less total time
// for a modest, deliberate ratio tradeoff. decompress() auto-detects
// whichever wrapper won, so it never needs to be told the mode.
const fast = compress(inputBytes, "fast")

// Async (chunks encoded in parallel across worker threads)
const compressed = await compressAsync(inputBytes)
const compressed = await compressAsync(inputBytes, 4) // explicit worker count
const compressedFast = await compressAsync(inputBytes, 4, undefined, "fast")

// Streaming
import { createCompressStream, createDecompressStream } from "pade-compress"
readable.pipe(createCompressStream()).pipe(writable)
```

---

## Benchmarks

The rows below marked `[Windows]` are re-measured on the current dev box after
two full rounds of work: actual-size candidate selection, approximate cyclic,
split/Rice/bitmap/RLE residuals, the LFSR model dictionary, lane-delta
composition, the full-file wrapper competition, model-aware chunking,
switching-LFSR bundling, deterministic search budgets, and a cheap pre-gate
that skips the approximate-LFSR search ladder on chunks with no plausible
algebraic structure. The `/bin/ls` and dictionary-text rows predate all of
that and were measured on macOS — not reproducible on this Windows dev box,
so they're left as the last known numbers.

```
GF(2⁸) geometric (L=1, perfect)          4 096 B →      49 B  ( 1.2%)  encode  31ms  decode  2ms   [Windows]
Noisy GF (L=1, 5% errors)                4 096 B →     428 B  (10.4%)  encode  18ms  decode  1ms   [Windows]
Padé offset (16-byte noise prefix)       4 096 B →      65 B  ( 1.6%)  encode   4ms  decode <1ms   [Windows]
Mixed LFSR (L=1/2/3 + 8% noise)      1 048 576 B →  10 197 B  ( 1.0%)  encode ~4.8s  decode  39ms  [Windows]
Binary executable (/bin/ls)               154 624 B →  29 875 B  (19.3%) encode 136ms  decode  4ms   [macOS, pre-session]
Natural language text (/usr/share/dict/words) →  ~100.1%           (no LFSR structure found)          [macOS, pre-session]
```

Decode is always near-instant — LFSR replay is a tight arithmetic loop with no branching. Encode time on the 1MB mixed file has grown across sessions as more candidate representations compete per chunk (each evaluated by actual serialized size, not just the first one that beats raw) — offset by short-circuits for clean exact fits, the approx-ladder pre-gate, and memoized residual compression that keep it from growing worse than that.

**Real-world corpus** (real ITU-T PRBS7/15/23/31 + real compiled binaries, `scripts/bench-real-world.ts`):

```
Real PRBS7/15/23/31 only (256 KB)     →  codec  42.6%   vs  brotli-11  62.5%
Real compiled binaries only (440 KB)  →  codec  47.5%   vs  brotli-11  46.5%
Full mixed real-world corpus (696 KB) →  codec  45.7%   vs  brotli-11  52.1%
```

The outer wrapper competition runs brotli at max quality (11) on the whole
serialized output as a fallback, so `compress()` is roughly as slow as plain
brotli-11 on inputs where that fallback ends up winning (non-algebraic
content) — a deliberate ratio-over-speed tradeoff, since that pass only runs
once per file rather than per chunk.

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
    cyclic.ts             Approximate cyclic detection: bounded period search + majority-vote template (+ .test.ts)
    gf-poly.ts            GF polynomial utilities: factorRoots, polyFromRoots (+ .test.ts)
  codec/
    encoder.ts            Candidate-based encoding pipeline (actual-size selection, not first-match);
                          budget/depth threading, switching-LFSR grouping, approx-ladder cheap gate
    candidates.ts         EncodeCandidate type + pickBest() — cheap estimate → top-K → real size
    decoder.ts            LFSR replay + residual XOR; cyclic/approx-cyclic/interleave/bitplane/
                          switching-LFSR decode
    format.ts             Binary serialization (PAD4/PAD5, CRC32, XDNI index, LFSR model dictionary,
                          switching-LFSR envelope)
    chunker.ts            Entropy chunking (±4 boundary refinement) + model-aware split (3-stage
                          cheap-gate → cheap-estimate → real-cost-verify funnel) (+ .test.ts)
    search-budget.ts      SearchBudget type + fast/balanced/max presets (+ .test.ts)
    candidate-trace.ts    Opt-in, disabled-by-default candidate tracing for debugging (+ .test.ts)
    stream.ts             Node.js streaming interface
    worker-pool.ts        Worker thread pool for parallel chunk encoding
    worker-entry.ts       Worker thread entry point
  utils/
    sparse.ts             Sparse residual encoding: dense / pairs / VarInt / split streams /
                          Rice-coded / bitmap / RLE (+ .test.ts)
    buffer.ts             Byte utilities
    interleave.ts         splitInterleave / mergeInterleave (m-lane decomposition)
    math.ts               Misc math helpers
  experimental/
    syndrome-residual.ts     Reed-Solomon-style syndrome residual prototype — NOT wired in (+ .test.ts)
    nonlinear-recurrence.ts  GF(256) quadratic-feature recurrence prototype — NOT wired in;
                             no real-world hits found in this project's target domain (+ .test.ts)
  wasm/
    analyzer.ts           WASM wrapper for the C analyzer (Emscripten build, optional)
scripts/
  gen-gf-file.ts               Generates the synthetic GF-structured test binary
  gen-real-world-file.ts       Generates a real-world corpus: real ITU-T PRBS7/15/23/31 +
                                slices of real compiled binaries already on the machine
  bench-priority1.ts           Deterministic benchmark corpus for actual-size candidate selection
  bench-syndrome.ts            Syndrome-residual prototype vs production sparse formats
  bench-nonlinear-feasibility.ts  Nonlinear-recurrence prototype vs the real fixture
  bench-rans-feasibility.ts    rANS entropy coding — Shannon-bound analysis (rejected, documented)
  bench-residual-context.ts   Residual context/delta modeling — rejected, documented
  bench-model-aware-chunking.ts  Model-aware chunking stress case (mixed-model boundary)
  bench-plain-vs-codec.ts      Codec vs plain gzip/brotli on synthetic mixed content
  bench-real-world.ts          Codec vs plain gzip/brotli/brotli-11 on the real-world corpus
  bench-algebraicity-gate.ts   Calibrates the approx-ladder cheap gate against real noisy data
  bench-transform-gate.ts      Diagnoses the delta/interleave transform gate's precision limits
  bench-lane-gate.ts           Calibrates lane-structure gates against real data (see below)
  bench-residual-brotli-quality.ts  Per-residual brotli quality bump — rejected, documented
  bench-zstd-feasibility.ts    zstd vs gzip/brotli on real-world data; ratio AND decompress speed
  run-gf-analyze.cjs           Cross-platform wrapper for the native c/gf-analyze CLI tool
test/
  gf-structured.bin       1MB synthetic GF file (L=1/2/3 segments + noise)
  real-world.bin          Real-world corpus (gitignored — embeds real system-binary slices;
                          regenerate locally with scripts/gen-real-world-file.ts)
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

**Actual-size candidate selection** — Every encode path (LFSR at every order, cyclic, delta wrapping) produces a candidate scored by a cheap estimate; only the top few are actually serialized (including real residual compression), and the smallest real wire size wins. Earlier this was first-match: whichever path succeeded first was kept even if a later path would have been smaller — e.g. a low-order LFSR fit and an exact-cyclic fit can both beat raw for the same bytes while differing 20%+ in final size.

**Cyclic / exact period encoding** — For data with exact period P (lookup tables, counter arrays, repeating test patterns), stores a single cycle. Competes against LFSR candidates on actual size rather than running only when no LFSR fit was found.

**Approximate cyclic encoding** — Generalizes exact period detection to periodicity plus sparse noise ("ABCABCXBCABCABC"). A two-phase bounded search — a cheap adjacent-repeat mismatch scan across candidate periods, then majority-vote template construction (per-position, across all repeats, not just the first) for the few best candidates — finds the period and template robust to noise landing anywhere, including the first repeat.

**Delta transforms** — XOR-first-difference, ADD-first-difference (mod 256), and XOR-second-difference are tried on chunks that pass the dual pre-gate. ADD-diff catches counter sequences that are linear over integers but not over GF(2⁸). Each is fully invertible; the transform ID is stored in the wire format.

**Interleave m=2,3,4** — Splits a byte stream into m lanes (bytes 0,m,2m,… / 1,m+1,2m+1,… / …) and encodes each independently. Useful when even-byte and odd-byte lanes carry different LFSR generators. A short BM complexity pre-screen (cap=5, window=20) skips non-LFSR lanes cheaply before committing to full encoding — the pre-screen also checks each lane after a delta transform, so a lane like an arithmetic counter (not directly GF(2^8)-linear, but constant after ADD-delta) isn't rejected before it gets a chance.

**Lane/plane delta composition** — An interleave or bitplane lane can be one delta transform deep (`interleave → delta → LFSR`), the one composition the original pipeline's `delta(interleave)` / `delta(bitplane)` wrapping didn't cover. Bounded to depth 1 beyond the lane's own structural search, using the same actual-size competition as the top-level delta wrap.

**Bit-plane decomposition** — Splits each byte into its 8 bit planes (bit b of every input byte → plane b). Each plane is encoded independently as a 0/1 byte sequence. Useful when different bit planes carry distinct linear structures — ADC/DAC samples (MSB planes carry magnitude patterns, LSBs are noisier), firmware images (opcode MSBs periodic, operand LSBs random). Same BM pre-screen gate as interleave.

**Dual pre-gate** — The delta/interleave/bitplane transform paths are gated by two fast checks before any expensive work: (1) entropy gate rejects already-statistically-compressible data (huffman estimate < 60% of raw); (2) algebraicity gate rejects random-like data by measuring how consistently BM complexity behaves across sliding 16-byte windows. Only data that is simultaneously high-entropy and algebraically structured reaches the transform paths.

**Wire format v4 (PAD4)** — Adds per-chunk CRC32, an EOF sentinel byte, and an XDNI index trailer (chunk offsets + original lengths) for O(1) random-access seek to any chunk. All chunk kinds use the same CRC placement (4 bytes after the chunk payload).

**Wire format v5 (PAD5) — LFSR model dictionary** — When the same GF(2^8) LFSR coefficient array recurs in non-adjacent chunks (adjacent runs are already merged), a file-level model table lets those chunks store a 2-byte model reference instead of repeating the coefficients. Only switches to PAD5 when the computed net savings (`L×(reuseCount-1) - tableOverhead`) are actually positive — plain PAD4 files pay zero overhead for this feature. Legacy PAD3/PAD4 files still decode unchanged.

**Split and Rice-coded sparse residuals** — Beyond interleaved position-value pairs, residuals can also be stored as two separate streams (positions, then values — better locality for the outer deflate/brotli pass) or with positions Rice/Golomb bit-packed (beats VarInt's 1-2 byte granularity on typical gap distributions). Both are always more expensive in raw bytes than the interleaved format, so they're only worth trying — and only actually compress smaller — past a minimum pair-count floor; below that, the encoder doesn't bother.

**Full-file wrapper competition** — The final output is whichever of {raw PAD bytes, cheap tier, brotli} is smallest. Brotli has no simple universal magic like gzip's `1f 8b`, so a brotli-wrapped file gets a 1-byte marker chosen to collide with neither the cheap tier's nor PAD's leading byte. Brotli runs at max quality (11): this pass runs once per file (not per chunk), so it can afford it — and real-world testing on non-algebraic content (compiled binaries) showed quality 9 left the codec measurably behind plain brotli-11 alone, which defeated the point of the fallback existing.

**zstd as the cheap tier, and a genuinely fast "fast" mode** — Node 22.15+ ships real libzstd bindings directly in the built-in `zlib` module (no external dependency); feature-detected at runtime and used in place of gzip when available, falling back to gzip on older Node (this package's stated floor stays >=18). Measured strictly smaller *and* faster than gzip-9 on every corpus tested, including the codec's own near-incompressible structural output (`scripts/bench-zstd-feasibility.ts`) — but brotli-11 still won outright on ratio in every real-world scenario tested, so zstd doesn't get added *alongside* brotli in the default competition (that would just add cost for a candidate that, per the evidence, never wins). The real find: `"fast"` mode's search budget only ever limited the *algebraic* search — the outer wrap still unconditionally paid brotli-11's cost regardless of mode, which measured out to roughly **half of fast mode's total time** on real-world input. `"fast"` mode now skips brotli entirely and relies on the cheap tier alone, cutting real-world `compress(_, "fast")` time from ~3.0s to ~1.7s for a modest, deliberate ratio tradeoff. `"balanced"`/`"max"` are unaffected — they still try both and keep whichever wins.

**Deterministic search budgets** — `search-budget.ts` defines `fast` / `balanced` (default) / `max` presets that cap how many expensive candidates, transform-depth levels, model solves, and chunk-boundary checks run per chunk. Threaded through both the synchronous and worker-thread-parallel encode paths so output is byte-identical regardless of scheduling — a budget trades search breadth for speed, never correctness.

**Candidate tracing** — `candidate-trace.ts` provides opt-in (disabled by default, near-zero overhead when off), per-chunk logging of every candidate considered and why it won or lost — for debugging encoder decisions without needing to re-derive them by hand.

**Model-aware chunking** — Blind midpoint bisection missed the case where two adjacent LFSRs share similar entropy but use completely different generators. Replaced with a three-stage funnel: a bounded scan for points where the *local* model changes (cheap short BM fits either side of a candidate boundary), a cheap whole-buffer cost re-rank of the best candidates, and only the top few finalists pay for real serialized-size verification. Only commits to a split when it's a measured win — random data reliably fails the final real-cost check even when it looked "different enough" in the cheap stages.

**Switching-LFSR bundling** — Adjacent model-aware-split pieces that came from the same entropy-chunk parent are also tried as a single envelope (one CRC32/XDNI-index entry covering several LFSR segments instead of one per segment), avoiding repeated per-chunk framing for long runs of short same-origin segments. Only chosen when actually smaller than encoding the pieces separately.

**Approx-ladder cheap gate** — The approximate LFSR search (L=1..5, each trying up to 8 offsets — brute-force/voting work that dominates encode time on non-algebraic chunks) is skipped when a handful of short (20-byte) exact-BM samples across the chunk find no order-≤5 fit anywhere. One clean sample is enough even under noise, since a short window has decent odds of landing in a noise-free stretch; true random or real text essentially never produces a low-order fit anywhere by chance. Calibrated against the fixture's own noisy L=3 segment (100% hit rate — zero false-negative risk on the codec's actual target domain) before shipping; cuts encode time ~26% on realistic mixed content with byte-identical output. See `scripts/bench-algebraicity-gate.ts`.

**Ideas evaluated and rejected (documented, not silently dropped):**
- **rANS entropy coding** for residual streams — Shannon-entropy-bound analysis (`scripts/bench-rans-feasibility.ts`) showed no realistic win over the existing sparse formats once framing overhead is accounted for.
- **Residual context/delta modeling** — lost in 4 of 5 tested scenarios against the existing sparse formats (`scripts/bench-residual-context.ts`).
- **Cross-chunk continuation** beyond what `mergeCompatibleChunks` already does — found architecturally redundant on direct code review; the existing LFSR-run continuity check already covers the case.
- **Nonlinear (quadratic-feature) recurrence models** — `src/experimental/nonlinear-recurrence.ts` is a correctness-verified GF(256) prototype, kept unwired: this project's target domain (hardware LFSRs) is dominated by *linear* generators by construction, and a feasibility run against the real fixture found zero hits (`scripts/bench-nonlinear-feasibility.ts`) — an explicitly valid, not-yet-useful outcome.
- **Tightening `laneIsStructured` / `algebraicityScore`** to reject more non-algebraic real content before the transform search runs — `scripts/bench-lane-gate.ts` found both gates already reject 91-99% of real (non-synthetic) non-algebraic content; a candidate 2-window generalization fix saved nothing measurable while costing real coverage (73%→49% acceptance) on the fixture's noisy target-domain data. Rejected.
- **Bumping per-residual brotli quality** (`bestWireFor`, format.ts) the same way the full-file wrapper was bumped to 11 — `scripts/bench-residual-brotli-quality.ts` found this call runs once per residual-packing candidate per chunk (not once per file), so the cost compounds across a file's chunks while residuals are typically already close to incompressible. Quality 9 cost +42% encode time for zero ratio gain on the synthetic fixture; quality 11 cost +138% for zero gain there and only 0.3% on the real-world corpus. Left at quality 6.
- **Adding zstd *alongside* brotli** in the default (`balanced`/`max`) outer-wrap competition, rather than only as `"fast"` mode's brotli replacement — `scripts/bench-zstd-feasibility.ts` found brotli-11 won on ratio in every real-world scenario tested (real PRBS, real binaries, the full mixed corpus), so trying zstd there too would only add compute for a candidate that never wins. Zstd earns its place specifically in `"fast"` mode instead, where brotli isn't tried at all.

**Syndrome-based residual encoding (prototyped, not enabled)** — `src/experimental/syndrome-residual.ts` implements Reed-Solomon-style syndrome decoding (Berlekamp-Massey + Chien search + Forney's algorithm) as an alternative sparse-residual format: store 2t syndromes instead of (position, value) pairs. Correctness-verified, but benchmarked as a net loss once realistic residual sizes and error distributions are accounted for — see the comment at the top of that file and `scripts/bench-syndrome.ts`.

**Polynomial factoring** — `gf-poly.ts` provides the full round-trip: `factorRoots` decomposes an LFSR minimal polynomial into its GF(2⁸) roots (when they're all distinct); `polyFromRoots` reconstructs the polynomial from roots via ∏(x + αᵢ). Together they enable inspecting whether a higher-order LFSR is a sum of independent geometric sequences.

**Boundary refinement** — After detecting entropy discontinuities, each candidate split point is tried at ±4-byte offsets and the one with the sharpest entropy contrast is kept. Aligns chunk boundaries with the true algebraic transition rather than the nearest scan position.

**Worker thread pool** — `compressAsync` distributes chunks across a pool of worker threads (defaults to `availableParallelism()`). Falls back to synchronous encoding if workers can't initialise.

**Sparse + deflate residuals** — Non-zero residual bytes are encoded as delta-compressed position-value pairs by default. For a chunk with 350 errors scattered across 4 096 bytes the average gap is ~12, meaning 75% of the uint32 gap bytes are zero — the resulting packed block compresses from ~1 KB down to ~50 bytes under deflate-9. This is the baseline the split-stream and Rice-coded formats above compete against.

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
npm test                               # 240 unit tests across 21 test files
npx tsx examples/demo.ts               # Synthetic roundtrip demo
npm run test:file                      # compress -> decompress -> native analyze on the fixture
npx tsx src/cli.ts bench <file>        # Benchmark any file
npx tsx src/cli.ts analyze <file>      # Algebraic structure report
npx tsx scripts/gen-real-world-file.ts # Regenerate the real-world validation corpus (local, gitignored)
npx tsx scripts/bench-real-world.ts    # Codec vs plain gzip/brotli on the real-world corpus
npx tsx scripts/bench-priority1.ts     # Actual-size candidate selection benchmark corpus
npx tsx scripts/bench-syndrome.ts      # Syndrome-residual prototype vs production sparse formats
npm run build:exe                      # Build a self-contained executable for the current platform
```

### Building executables locally

`npm run build:exe` compiles TypeScript, rebuilds the native addon, and bundles the CLI into a single executable via [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg). The resulting binary + `pade_compress_addon.node` sidecar land in `executables/`. Both files are required together.

To produce all three platform targets from a single machine you need to cross-compile the native addon (non-trivial). The recommended path is to push a `v*` tag and let GitHub Actions build each platform natively:

```bash
git tag v0.1.2 && git push origin v0.1.2
```

This triggers `.github/workflows/release.yml`, which builds on `windows-latest`, `ubuntu-latest`, and `macos-latest` and publishes all three archives to the GitHub release automatically.

240 tests across 21 test files covering sparse encoding (dense/pairs/VarInt/split/Rice/bitmap/RLE), Padé search (via C addon), GF polynomial round-trips, approximate LFSR detection (L=1..5), approximate cyclic detection, chunking with boundary refinement and model-aware splitting, dual pre-gate (entropy + algebraicity), actual-size candidate selection, the LFSR model dictionary, lane-delta composition, switching-LFSR bundling, search budgets, candidate tracing, the full-file wrapper competition (including the zstd cheap tier and fast-mode's brotli skip), the syndrome-residual and nonlinear-recurrence prototypes, and end-to-end roundtrips (including sync/worker-parallel parity).
