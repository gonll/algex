// Binary serialization for CompressedFile.
//
// Format v4 (magic "PAD4" = 0x50414434):
//   Header: [4] magic + [4] originalSize + [4] chunkCount
//   Per-chunk: payload bytes + [4] CRC32
//   EOF sentinel: [1] 0xFE
//   XDNI index: [4] "XDNI" + [4] chunkCount + [N×8] {chunkOffset, origLen} + [4] indexOffset
//
// Chunk kinds:
//   0  Raw       [1] kind  [4] dataLen  [N] data
//   1  LFSR      [1] kind  [4] origLen  [1] prefixLen  [P] prefix
//                [2] lfsrLen L  [L] coeffs  [L] seed
//                [1] residualFlag (0=plain 1=deflate 2=brotli)  [payload]
//   2  Cyclic    [1] kind  [4] origLen  [2] period P  [P] cycle
//   3  Delta     [1] kind  [4] origLen  [1] deltaId  [4] innerLen  [inner]
//   4  Affine    [1] kind  [4] origLen  [1] k         [4] innerLen  [inner]
//   5  Interleave[1] kind  [4] origLen  [1] m  m×{ [4] laneLen [lane] }
//   6  Bitplane  [1] kind  [4] origLen  [1] planeCount  8×{ [4] planeLen [plane] }
//   7  LFSR16    [1] kind  [4] origLen  [1] L16  [L16*2] coeffs(uint16 LE)
//                [L16*2] seed(uint16 LE)  [1] residualFlag  [payload]
//   0xFE EOF sentinel

import { deflateRawSync, inflateRawSync, brotliCompressSync, brotliDecompressSync, constants } from "zlib"
import { CompressedFile, Chunk, CyclicChunk, SimpleChunk, LFSRChunk, DeltaChunk, AffineChunk, InterleaveChunk, BitplaneChunk, LFSR16Chunk, NonDeltaChunk } from "../types"
import { packResidual, unpackResidual } from "../utils/sparse"

const MAGIC_V3        = 0x50414445  // "PADE"
const MAGIC_V4        = 0x50414434  // "PAD4"
const KIND_RAW        = 0
const KIND_LFSR       = 1
const KIND_CYCLIC     = 2
const KIND_DELTA      = 3
const KIND_AFFINE     = 4
const KIND_INTERLEAVE = 5
const KIND_BITPLANE   = 6
const KIND_LFSR16     = 7
const KIND_EOF        = 0xFE
const XDNI_MAGIC      = 0x58444E49  // "XDNI"
const RES_PLAIN       = 0
const RES_DEFLATED    = 1
const RES_BROTLI      = 2

// ── CRC32 ────────────────────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

const crc32 = (data: Uint8Array): number => {
  let crc = 0xFFFFFFFF
  for (const b of data) crc = CRC32_TABLE[(crc ^ b) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ── Residual wire encoding ────────────────────────────────────────────────────

// Try deflate and brotli on the sparse-packed residual; return whichever is smallest.
const wireResidual = (residual: Uint8Array): Uint8Array => {
  const packed   = packResidual(residual)
  const deflated = deflateRawSync(packed, { level: 9 })
  const brotlied = brotliCompressSync(packed, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } })

  const plainSize  = 1 + packed.length
  const deflSize   = 5 + deflated.length
  const brotliSize = 5 + brotlied.length

  if (brotliSize < deflSize && brotliSize < plainSize) {
    const out = new Uint8Array(brotliSize)
    new DataView(out.buffer).setUint32(1, brotlied.length)
    out[0] = RES_BROTLI
    out.set(brotlied, 5)
    return out
  }
  if (deflSize < plainSize) {
    const out = new Uint8Array(deflSize)
    new DataView(out.buffer).setUint32(1, deflated.length)
    out[0] = RES_DEFLATED
    out.set(deflated, 5)
    return out
  }
  const out = new Uint8Array(plainSize)
  out[0] = RES_PLAIN
  out.set(packed, 1)
  return out
}

// ── Prepared chunk types ──────────────────────────────────────────────────────

type PreparedRaw        = { kind: "raw";        chunk: Extract<Chunk, { kind: "raw" }> }
type PreparedLFSR       = { kind: "lfsr";       chunk: Extract<Chunk, { kind: "lfsr" }>;   rWire: Uint8Array }
type PreparedCyclic     = { kind: "cyclic";     chunk: CyclicChunk }
type PreparedDelta      = { kind: "delta";      chunk: DeltaChunk;      innerBuf: Uint8Array }
type PreparedAffine     = { kind: "affine";     chunk: AffineChunk;     innerBuf: Uint8Array }
type PreparedInterleave = { kind: "interleave"; chunk: InterleaveChunk; laneBufs: Uint8Array[] }
type PreparedBitplane   = { kind: "bitplane";   chunk: BitplaneChunk;   planeBufs: Uint8Array[] }
type PreparedLFSR16     = { kind: "lfsr16";     chunk: LFSR16Chunk;     rWire: Uint8Array }
type Prepared = PreparedRaw | PreparedLFSR | PreparedCyclic | PreparedDelta | PreparedAffine
              | PreparedInterleave | PreparedBitplane | PreparedLFSR16

// ── Simple chunk serialization (used for lane/plane embedding) ────────────────

const preparedSimpleSize = (p: PreparedRaw | PreparedLFSR | PreparedCyclic): number => {
  if (p.kind === "raw")    return 1 + 4 + p.chunk.data.length
  if (p.kind === "cyclic") return 1 + 4 + 2 + p.chunk.cycle.length
  const { prefix, lfsr, init } = p.chunk
  return 1 + 4 + 1 + prefix.length + 2 + lfsr.coeffs.length + init.length + p.rWire.length
}

const writeSimpleChunk = (
  buf: Uint8Array, view: DataView,
  p: PreparedRaw | PreparedLFSR | PreparedCyclic,
  off: number
): number => {
  const start = off
  if (p.kind === "raw") {
    buf[off++] = KIND_RAW
    view.setUint32(off, p.chunk.data.length); off += 4
    buf.set(p.chunk.data, off); off += p.chunk.data.length
    return off - start
  }
  if (p.kind === "cyclic") {
    buf[off++] = KIND_CYCLIC
    view.setUint32(off, p.chunk.originalLength); off += 4
    view.setUint16(off, p.chunk.cycle.length);   off += 2
    buf.set(p.chunk.cycle, off); off += p.chunk.cycle.length
    return off - start
  }
  const { prefix, lfsr, init, originalLength } = p.chunk
  buf[off++] = KIND_LFSR
  view.setUint32(off, originalLength); off += 4
  buf[off++] = prefix.length
  buf.set(prefix, off); off += prefix.length
  view.setUint16(off, lfsr.coeffs.length); off += 2
  for (const c of lfsr.coeffs) buf[off++] = c
  for (const v of init)        buf[off++] = v
  buf.set((p as PreparedLFSR).rWire, off); off += (p as PreparedLFSR).rWire.length
  return off - start
}

const serializeSimpleChunk = (chunk: SimpleChunk): Uint8Array => {
  let p: PreparedRaw | PreparedLFSR | PreparedCyclic
  if (chunk.kind === "lfsr")   p = { kind: "lfsr",   chunk, rWire: wireResidual(chunk.residual) }
  else if (chunk.kind === "cyclic") p = { kind: "cyclic", chunk }
  else p = { kind: "raw", chunk }
  const buf = new Uint8Array(preparedSimpleSize(p))
  writeSimpleChunk(buf, new DataView(buf.buffer), p, 0)
  return buf
}

// ── General chunk size + write (defined before prepare so prepare can call them) ──

const preparedSize = (p: Prepared): number => {
  if (p.kind === "raw")        return 1 + 4 + p.chunk.data.length
  if (p.kind === "cyclic")     return 1 + 4 + 2 + p.chunk.cycle.length
  if (p.kind === "delta")      return 1 + 4 + 1 + 4 + p.innerBuf.length
  if (p.kind === "affine")     return 1 + 4 + 1 + 4 + p.innerBuf.length
  if (p.kind === "interleave") return 1 + 4 + 1 + p.laneBufs.reduce((s, b) => s + 4 + b.length, 0)
  if (p.kind === "bitplane")   return 1 + 4 + 1 + p.planeBufs.reduce((s, b) => s + 4 + b.length, 0)
  if (p.kind === "lfsr16") {
    const L16 = p.chunk.coeffs.length
    return 1 + 4 + 1 + L16 * 2 + L16 * 2 + p.rWire.length
  }
  // lfsr
  const { prefix, lfsr, init } = p.chunk
  return 1 + 4 + 1 + prefix.length + 2 + lfsr.coeffs.length + init.length + p.rWire.length
}

const writeChunk = (buf: Uint8Array, view: DataView, p: Prepared, off: number): number => {
  const start = off

  if (p.kind === "raw") {
    buf[off++] = KIND_RAW
    view.setUint32(off, p.chunk.data.length); off += 4
    buf.set(p.chunk.data, off); off += p.chunk.data.length
    return off - start
  }

  if (p.kind === "cyclic") {
    buf[off++] = KIND_CYCLIC
    view.setUint32(off, p.chunk.originalLength); off += 4
    view.setUint16(off, p.chunk.cycle.length);   off += 2
    buf.set(p.chunk.cycle, off); off += p.chunk.cycle.length
    return off - start
  }

  if (p.kind === "delta") {
    buf[off++] = KIND_DELTA
    view.setUint32(off, p.chunk.originalLength); off += 4
    buf[off++] = p.chunk.deltaId
    view.setUint32(off, p.innerBuf.length); off += 4
    buf.set(p.innerBuf, off); off += p.innerBuf.length
    return off - start
  }

  if (p.kind === "affine") {
    buf[off++] = KIND_AFFINE
    view.setUint32(off, p.chunk.originalLength); off += 4
    buf[off++] = p.chunk.k
    view.setUint32(off, p.innerBuf.length); off += 4
    buf.set(p.innerBuf, off); off += p.innerBuf.length
    return off - start
  }

  if (p.kind === "interleave") {
    buf[off++] = KIND_INTERLEAVE
    view.setUint32(off, p.chunk.originalLength); off += 4
    buf[off++] = p.chunk.m
    for (const laneBuf of p.laneBufs) {
      view.setUint32(off, laneBuf.length); off += 4
      buf.set(laneBuf, off); off += laneBuf.length
    }
    return off - start
  }

  if (p.kind === "bitplane") {
    buf[off++] = KIND_BITPLANE
    view.setUint32(off, p.chunk.originalLength); off += 4
    buf[off++] = p.planeBufs.length
    for (const planeBuf of p.planeBufs) {
      view.setUint32(off, planeBuf.length); off += 4
      buf.set(planeBuf, off); off += planeBuf.length
    }
    return off - start
  }

  if (p.kind === "lfsr16") {
    const { coeffs, seed, originalLength } = p.chunk
    const L16 = coeffs.length
    buf[off++] = KIND_LFSR16
    view.setUint32(off, originalLength); off += 4
    buf[off++] = L16
    for (const c of coeffs) { view.setUint16(off, c); off += 2 }
    buf.set(seed, off); off += seed.length   // seed is already L16*2 raw bytes
    buf.set(p.rWire, off); off += p.rWire.length
    return off - start
  }

  // KIND_LFSR
  const { prefix, lfsr, init, originalLength } = p.chunk
  buf[off++] = KIND_LFSR
  view.setUint32(off, originalLength);      off += 4
  buf[off++] = prefix.length
  buf.set(prefix, off);         off += prefix.length
  view.setUint16(off, lfsr.coeffs.length);  off += 2
  for (const c of lfsr.coeffs) buf[off++] = c
  for (const v of init)        buf[off++] = v
  buf.set(p.rWire, off);        off += p.rWire.length
  return off - start
}

// Serialize any chunk to a standalone byte blob (no file header, no CRC).
// Used for embedding inner chunks inside delta wrappers (depth-2 support).
// Defined after writeChunk/preparedSize so prepare() can call it without
// a forward-reference issue — by the time prepare() is actually invoked,
// all const functions in this module are already initialized.
const serializeInnerChunk = (chunk: NonDeltaChunk): Uint8Array => {
  const p   = prepare(chunk)
  const buf = new Uint8Array(preparedSize(p))
  writeChunk(buf, new DataView(buf.buffer), p, 0)
  return buf
}

// ── prepare ───────────────────────────────────────────────────────────────────

const prepare = (chunk: Chunk): Prepared => {
  if (chunk.kind === "lfsr")       return { kind: "lfsr",       chunk, rWire: wireResidual(chunk.residual) }
  if (chunk.kind === "cyclic")     return { kind: "cyclic",     chunk }
  if (chunk.kind === "lfsr16")     return { kind: "lfsr16",     chunk, rWire: wireResidual(chunk.residual) }
  if (chunk.kind === "affine")     return { kind: "affine",     chunk, innerBuf: serializeSimpleChunk(chunk.inner) }
  if (chunk.kind === "interleave") return { kind: "interleave", chunk, laneBufs: chunk.lanes.map(serializeSimpleChunk) }
  if (chunk.kind === "bitplane")   return { kind: "bitplane",   chunk, planeBufs: chunk.planes.map(serializeSimpleChunk) }
  // DeltaChunk.inner is NonDeltaChunk — may be interleave/bitplane (depth-2), use serializeInnerChunk
  if (chunk.kind === "delta")      return { kind: "delta",      chunk, innerBuf: serializeInnerChunk(chunk.inner) }
  return { kind: "raw", chunk }
}

// ── serialize ─────────────────────────────────────────────────────────────────

export const serialize = (file: CompressedFile): Uint8Array => {
  const prepared   = file.chunks.map(prepare)
  const chunkSizes = prepared.map(preparedSize)
  const n          = prepared.length

  const chunkPayloadTotal = chunkSizes.reduce((s, cs) => s + cs, 0)
  const totalSize =
    12 +
    chunkPayloadTotal + n * 4 +
    1 +
    4 + 4 + n * 8 + 4

  const buf  = new Uint8Array(totalSize)
  const view = new DataView(buf.buffer)
  let off = 0

  view.setUint32(off, MAGIC_V4);            off += 4
  view.setUint32(off, file.originalSize);   off += 4
  view.setUint32(off, n);                   off += 4

  const chunkOffsets: number[] = []
  for (let i = 0; i < n; i++) {
    chunkOffsets.push(off)
    const payloadLen = writeChunk(buf, view, prepared[i]!, off)
    const chunkCRC   = crc32(buf.subarray(off, off + payloadLen))
    off += payloadLen
    view.setUint32(off, chunkCRC); off += 4
  }

  buf[off++] = KIND_EOF

  const indexOffset = off
  view.setUint32(off, XDNI_MAGIC); off += 4
  view.setUint32(off, n);          off += 4
  for (let i = 0; i < n; i++) {
    view.setUint32(off, chunkOffsets[i]!); off += 4
    const p = prepared[i]!
    const origLen = p.kind === "raw"
      ? p.chunk.data.length
      : p.chunk.originalLength
    view.setUint32(off, origLen); off += 4
  }
  view.setUint32(off, indexOffset); off += 4

  return buf
}

// ── serializeChunk ────────────────────────────────────────────────────────────

// Serialize a single chunk to a standalone byte blob (no file header, no CRC).
// Used by worker threads: each worker returns its chunk as bytes.
export const serializeChunk = (chunk: Chunk): Uint8Array => {
  const p    = prepare(chunk)
  const buf  = new Uint8Array(preparedSize(p))
  writeChunk(buf, new DataView(buf.buffer), p, 0)
  return buf
}

// ── readChunkInner ────────────────────────────────────────────────────────────

type ChunkOrSentinel = Chunk | { kind: "__eof__" }

const readChunkInner = (buf: Uint8Array, off: number, isV4: boolean): [ChunkOrSentinel, number] => {
  const view  = new DataView(buf.buffer, buf.byteOffset)
  const start = off
  const kind  = buf[off]!

  if (kind === KIND_EOF) return [{ kind: "__eof__" }, 1]

  off++  // consume kind byte

  if (kind === KIND_RAW) {
    const len = view.getUint32(off); off += 4
    const data = buf.slice(off, off + len); off += len
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "raw", data }, off - start]
  }

  if (kind === KIND_CYCLIC) {
    const originalLength = view.getUint32(off); off += 4
    const period         = view.getUint16(off);  off += 2
    const cycle          = buf.slice(off, off + period); off += period
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "cyclic", cycle, originalLength }, off - start]
  }

  if (kind === KIND_DELTA) {
    const originalLength = view.getUint32(off); off += 4
    const deltaId = buf[off++]!
    const innerLen = view.getUint32(off); off += 4
    const innerBuf = buf.slice(off, off + innerLen); off += innerLen
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    const inner = readChunkInner(innerBuf, 0, false)[0] as NonDeltaChunk
    return [{ kind: "delta", deltaId, inner, originalLength }, off - start]
  }

  if (kind === KIND_AFFINE) {
    const originalLength = view.getUint32(off); off += 4
    const k = buf[off++]!
    const innerLen = view.getUint32(off); off += 4
    const innerBuf = buf.slice(off, off + innerLen); off += innerLen
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    const inner = readChunkInner(innerBuf, 0, false)[0] as LFSRChunk
    return [{ kind: "affine", k, inner, originalLength }, off - start]
  }

  if (kind === KIND_INTERLEAVE) {
    const originalLength = view.getUint32(off); off += 4
    const m = buf[off++]!
    const lanes: SimpleChunk[] = []
    for (let j = 0; j < m; j++) {
      const laneLen = view.getUint32(off); off += 4
      const laneBuf = buf.slice(off, off + laneLen); off += laneLen
      lanes.push(readChunkInner(laneBuf, 0, false)[0] as SimpleChunk)
    }
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "interleave", m, lanes, originalLength }, off - start]
  }

  if (kind === KIND_BITPLANE) {
    const originalLength = view.getUint32(off); off += 4
    const planeCount = buf[off++]!
    const planes: SimpleChunk[] = []
    for (let j = 0; j < planeCount; j++) {
      const planeLen = view.getUint32(off); off += 4
      const planeBuf = buf.slice(off, off + planeLen); off += planeLen
      planes.push(readChunkInner(planeBuf, 0, false)[0] as SimpleChunk)
    }
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "bitplane", planes, originalLength }, off - start]
  }

  if (kind === KIND_LFSR16) {
    const originalLength = view.getUint32(off); off += 4
    const L16 = buf[off++]!
    const coeffs: number[] = []
    for (let j = 0; j < L16; j++) { coeffs.push(view.getUint16(off)); off += 2 }
    const seed = buf.slice(off, off + L16 * 2); off += L16 * 2
    const lfsrRegionLen = originalLength  // LFSR16 covers the full chunk (no prefix)
    const flag = buf[off++]!
    let residual: Uint8Array
    if (flag === RES_BROTLI) {
      const compLen = view.getUint32(off); off += 4
      const plain   = brotliDecompressSync(buf.slice(off, off + compLen)); off += compLen
      ;[residual]   = unpackResidual(plain, 0, lfsrRegionLen)
    } else if (flag === RES_DEFLATED) {
      const deflLen = view.getUint32(off); off += 4
      const plain   = inflateRawSync(buf.slice(off, off + deflLen)); off += deflLen
      ;[residual]   = unpackResidual(plain, 0, lfsrRegionLen)
    } else {
      const [res, consumed] = unpackResidual(buf, off, lfsrRegionLen)
      residual = res; off += consumed
    }
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "lfsr16", coeffs, seed, residual, originalLength }, off - start]
  }

  // KIND_LFSR
  const originalLength = view.getUint32(off);  off += 4
  const prefixLen      = buf[off++]!
  const prefix         = buf.slice(off, off + prefixLen); off += prefixLen
  const lfsrLen        = view.getUint16(off);  off += 2
  const coeffs  = Array.from(buf.subarray(off, off + lfsrLen)); off += lfsrLen
  const init    = Array.from(buf.subarray(off, off + lfsrLen)); off += lfsrLen

  const lfsrRegionLen = originalLength - prefixLen
  const flag          = buf[off++]!
  let residual: Uint8Array

  if (flag === RES_BROTLI) {
    const compLen = view.getUint32(off); off += 4
    const plain   = brotliDecompressSync(buf.slice(off, off + compLen)); off += compLen
    ;[residual]   = unpackResidual(plain, 0, lfsrRegionLen)
  } else if (flag === RES_DEFLATED) {
    const deflLen = view.getUint32(off); off += 4
    const plain   = inflateRawSync(buf.slice(off, off + deflLen)); off += deflLen
    ;[residual]   = unpackResidual(plain, 0, lfsrRegionLen)
  } else {
    const [res, consumed] = unpackResidual(buf, off, lfsrRegionLen)
    residual = res; off += consumed
  }

  const payloadEnd = off
  if (isV4) {
    const stored = view.getUint32(off); off += 4
    const actual = crc32(buf.subarray(start, payloadEnd))
    if (stored !== actual) throw new Error(`CRC mismatch at offset ${start}: expected 0x${actual.toString(16)}, got 0x${stored.toString(16)}`)
  }

  return [
    { kind: "lfsr", prefix, lfsr: { coeffs, length: lfsrLen }, init, residual, originalLength },
    off - start,
  ]
}

// ── deserializeChunk ──────────────────────────────────────────────────────────

export const deserializeChunk = (buf: Uint8Array): Chunk =>
  readChunkInner(buf, 0, false)[0] as Chunk

// ── readChunkAt (O(1) seek via XDNI index) ───────────────────────────────────

export const readChunkAt = (buf: Uint8Array, chunkIndex: number): Chunk | null => {
  if (buf.length < 8) return null
  const view = new DataView(buf.buffer, buf.byteOffset)
  const indexOffset = view.getUint32(buf.length - 4)
  if (indexOffset + 4 > buf.length) return null
  if (view.getUint32(indexOffset) !== XDNI_MAGIC) return null
  const count = view.getUint32(indexOffset + 4)
  if (chunkIndex < 0 || chunkIndex >= count) return null
  const entryOff   = indexOffset + 8 + chunkIndex * 8
  const chunkStart = view.getUint32(entryOff)
  return readChunkInner(buf, chunkStart, true)[0] as Chunk
}

// ── deserialize ───────────────────────────────────────────────────────────────

export const deserialize = (buf: Uint8Array): CompressedFile => {
  const view = new DataView(buf.buffer, buf.byteOffset)
  let off = 0

  const magic = view.getUint32(off); off += 4
  const isV4  = magic === MAGIC_V4
  if (magic !== MAGIC_V3 && magic !== MAGIC_V4)
    throw new Error(`Bad magic: expected PADE or PAD4, got 0x${magic.toString(16)}`)

  const originalSize = view.getUint32(off); off += 4
  const chunkCount   = view.getUint32(off); off += 4
  const chunks: CompressedFile["chunks"] = []

  if (isV4) {
    for (let i = 0; i < chunkCount; i++) {
      if (off >= buf.length) break
      if (buf[off] === KIND_EOF) break
      const [item, consumed] = readChunkInner(buf, off, true)
      if (item.kind === "__eof__") break
      chunks.push(item as Chunk)
      off += consumed
    }
  } else {
    for (let i = 0; i < chunkCount; i++) {
      const [item, consumed] = readChunkInner(buf, off, false)
      chunks.push(item as Chunk)
      off += consumed
    }
  }

  return { chunks, originalSize }
}

// ── streamDeserialize ─────────────────────────────────────────────────────────

export function* streamDeserialize(buf: Uint8Array): Iterable<Chunk> {
  const view = new DataView(buf.buffer, buf.byteOffset)
  let off = 0

  const magic = view.getUint32(off); off += 4
  const isV4  = magic === MAGIC_V4
  if (magic !== MAGIC_V3 && magic !== MAGIC_V4)
    throw new Error(`Bad magic: expected PADE or PAD4, got 0x${magic.toString(16)}`)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _originalSize = view.getUint32(off); off += 4
  const chunkCount    = view.getUint32(off); off += 4

  if (isV4) {
    let yielded = 0
    while (yielded < chunkCount && off < buf.length) {
      if (buf[off] === KIND_EOF) break
      const [item, consumed] = readChunkInner(buf, off, true)
      if (item.kind === "__eof__") break
      yield item as Chunk
      off += consumed
      yielded++
    }
  } else {
    for (let i = 0; i < chunkCount; i++) {
      const [item, consumed] = readChunkInner(buf, off, false)
      yield item as Chunk
      off += consumed
    }
  }
}
