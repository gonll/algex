// All shared domain types
// GF(2^8) is the native field for bytes: all 256 byte values are field elements.

// A GF(2^8) element — plain byte value, no bigint overhead
export type GFElem = number

// LFSR produced by Berlekamp-Massey over GF(2^8)
// Encodes: s[k] = Σ coeffs[i] * s[k-1-i]  for i = 0..length-1
// (operations are GF(2^8): addition = XOR, multiplication via AES polynomial)
export interface LFSR {
  readonly coeffs: GFElem[]
  readonly length: number
}

// A chunk compressed as: verbatim prefix + LFSR prediction + sparse XOR residual.
// prefix covers the Padé [k/L] numerator transient (empty for standard BM).
export interface LFSRChunk {
  readonly kind: "lfsr"
  readonly prefix: Uint8Array   // bytes 0..k-1 stored verbatim (k=0 for pure BM)
  readonly lfsr: LFSR
  readonly init: GFElem[]       // first `length` bytes of the LFSR region (after prefix)
  readonly residual: Uint8Array // LFSR-region actual XOR predicted; empty = perfect
  readonly originalLength: number
}

// A chunk where no algebraic structure was found — stored verbatim
export interface RawChunk {
  readonly kind: "raw"
  readonly data: Uint8Array
}

// A chunk whose byte sequence is exactly periodic with period P.
// Stores a single cycle; decode by tiling to originalLength.
export interface CyclicChunk {
  readonly kind: "cyclic"
  readonly cycle: Uint8Array    // one full period (P bytes)
  readonly originalLength: number
}

// The three chunk kinds that carry no nested chunk structure.
export type SimpleChunk = LFSRChunk | RawChunk | CyclicChunk

// A chunk encoded as an LFSR over GF(2^16).
// Treats pairs of bytes as little-endian uint16 elements.
// Useful for 16-bit sample data (ADC/DAC, audio) where the word-level recurrence
// is shorter than the byte-level recurrence found by GF(2^8) BM.
export interface LFSR16Chunk {
  readonly kind: "lfsr16"
  readonly coeffs: number[]     // GF(2^16) coefficients (uint16 values)
  readonly seed: Uint8Array     // first L*2 bytes (L uint16 LE words = seed)
  readonly residual: Uint8Array // XOR of predicted vs actual bytes; empty = perfect
  readonly originalLength: number
}

// A chunk encoded after applying a delta transform to the original bytes.
// Decode: decode inner → invert delta → original bytes.
// inner may be any non-delta chunk kind (including interleave and bitplane),
// enabling depth-2 compositions like delta(interleave) or delta(bitplane).
export interface DeltaChunk {
  readonly kind: "delta"
  readonly deltaId: number      // 3=xor1  4=add1  5=xor2
  readonly inner: NonDeltaChunk
  readonly originalLength: number
}

// Any chunk kind that is not itself a DeltaChunk.
// Used as the inner type of DeltaChunk to prevent delta-of-delta nesting.
export type NonDeltaChunk = SimpleChunk | LFSR16Chunk | AffineChunk | InterleaveChunk | BitplaneChunk

// An affine L=1 chunk: y[n] = c*y[n-1] ^ b, stored as inner LFSR on z[n] = y[n] ^ k.
// Decode: decode inner LFSR → XOR every byte by k → original bytes.
export interface AffineChunk {
  readonly kind: "affine"
  readonly k: number
  readonly inner: LFSRChunk
  readonly originalLength: number
}

// m-way interleaved chunk: lanes encoded independently, merged on decode.
export interface InterleaveChunk {
  readonly kind: "interleave"
  readonly m: number
  readonly lanes: SimpleChunk[]
  readonly originalLength: number
}

// Each of the 8 bit-planes (plane b = bit b of every input byte, stored as 0/1 bytes)
// encoded independently.  Decode: decode each plane → mergeBitplanes → original bytes.
export interface BitplaneChunk {
  readonly kind: "bitplane"
  readonly planes: SimpleChunk[]   // exactly 8 elements, index = bit position (0=LSB)
  readonly originalLength: number
}

export type Chunk = SimpleChunk | LFSR16Chunk | DeltaChunk | AffineChunk | InterleaveChunk | BitplaneChunk

export interface CompressedFile {
  readonly chunks: Chunk[]
  readonly originalSize: number
}
