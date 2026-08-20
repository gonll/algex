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
//   8  ApproxCyclic [1] kind  [4] origLen  [2] period P  [P] cycle
//                   [1] residualFlag (0=plain 1=deflate 2=brotli)  [payload]
//   9  LFSRRef   [1] kind  [4] origLen  [1] prefixLen  [P] prefix
//               [2] modelId  [L] seed (L looked up from the model table)
//               [1] residualFlag  [payload]           (PAD5 only)
//   0xFE EOF sentinel
//
// Format v5 (magic "PAD5" = 0x50414435): PAD4 plus a file-level LFSR model
// dictionary inserted right after the header:
//   [2] modelCount, modelCount×{ [2] L, [L] coeffs }
// Only emitted when at least one repeated GF(2^8) LFSR coefficient array is
// found across (non-adjacent) top-level chunks AND the dictionary's net byte
// savings are positive — see buildModelDictionary. Plain PAD4 (no dictionary
// section, and every LFSR chunk keeps its coefficients inline) still decodes
// unchanged; readers only need to look for the dictionary section when the
// magic is PAD5.

import { deflateRawSync, inflateRawSync, brotliCompressSync, brotliDecompressSync, constants } from "zlib"
import { CompressedFile, Chunk, CyclicChunk, ApproxCyclicChunk, SimpleChunk, LaneChunk, LFSRChunk, DeltaChunk, AffineChunk, InterleaveChunk, BitplaneChunk, LFSR16Chunk, NonDeltaChunk, SwitchingLFSRChunk } from "../types"
import { packResidual, packSplitResidual, packRiceResidual, packBitmapResidual, packRLEResidual, unpackResidual } from "../utils/sparse"

const MAGIC_V3        = 0x50414445  // "PADE"
const MAGIC_V4        = 0x50414434  // "PAD4"
const MAGIC_V5        = 0x50414435  // "PAD5" — PAD4 + a file-level LFSR model dictionary
const KIND_RAW        = 0
const KIND_LFSR       = 1
const KIND_CYCLIC     = 2
const KIND_DELTA      = 3
const KIND_AFFINE     = 4
const KIND_INTERLEAVE = 5
const KIND_BITPLANE   = 6
const KIND_LFSR16     = 7
const KIND_APPROX_CYCLIC = 8
const KIND_LFSR_REF   = 9   // PAD5 only: same as KIND_LFSR but coeffs come from the model table
const KIND_SWITCHING_LFSR = 10  // roadmap 2, Priority 4: a run of adjacent LFSR segments sharing one envelope
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

// ── Priority 5: file-level LFSR model dictionary ──────────────────────────────
//
// Deduplicates repeated GF(2^8) LFSR coefficient arrays across top-level chunks.
// Adjacent runs sharing a model are already merged into one chunk by the encoder
// (encoder.ts's mergeCompatibleChunks), so what's left here is non-adjacent
// reuse — the same model appearing again later in the file with unrelated chunks
// between uses. Only nested/composite chunk kinds (affine, interleave, bitplane,
// delta) are excluded — deduplicating into those would need a bigger reference
// scheme for comparatively little payoff, so this stays deliberately scoped to
// the common top-level case.

interface LFSRModelEntry { readonly coeffs: number[]; readonly length: number }

// Per-model net byte savings from moving N identical-coefficient chunks into
// the dictionary: each usage drops from [2]lfsrLen+[L]coeffs to [2]modelId
// (saving L bytes per use), against a one-time [2]L+[L]coeffs table entry cost.
const modelNetSavings = (length: number, useCount: number): number =>
  length * (useCount - 1) - 2

const buildModelDictionary = (
  chunks: readonly Chunk[]
): { models: LFSRModelEntry[]; refModelId: ReadonlyMap<number, number> } => {
  const groups = new Map<string, { coeffs: number[]; length: number; indices: number[] }>()
  chunks.forEach((c, i) => {
    if (c.kind !== "lfsr") return
    const key = c.lfsr.coeffs.join(",")
    const g = groups.get(key)
    if (g) g.indices.push(i)
    else groups.set(key, { coeffs: c.lfsr.coeffs, length: c.lfsr.length, indices: [i] })
  })

  const candidates = [...groups.values()]
    .map(g => ({ ...g, net: modelNetSavings(g.length, g.indices.length) }))
    .filter(g => g.net > 0)

  // The dictionary section itself costs 2 bytes (modelCount) — only worth
  // switching formats at all if the included models' total savings clear that.
  const totalNet = candidates.reduce((s, g) => s + g.net, 0)
  if (totalNet <= 2) return { models: [], refModelId: new Map() }

  const models: LFSRModelEntry[] = []
  const refModelId = new Map<number, number>()
  for (const g of candidates) {
    const modelId = models.length
    models.push({ coeffs: g.coeffs, length: g.length })
    for (const idx of g.indices) refModelId.set(idx, modelId)
  }
  return { models, refModelId }
}

// ── Residual wire encoding ────────────────────────────────────────────────────

// Candidate selection (Priority 1) calls realSize -> serializeChunk to rank
// finalists by actual size, then the winning chunk is serialized again inside
// the whole-file serialize() call. Both calls hit the same residual Uint8Array
// instance, so memoizing here skips the duplicate deflate+brotli work.
const wireResidualCache = new WeakMap<Uint8Array, Uint8Array>()

// Try deflate and brotli on the sparse-packed residual; return whichever is smallest.
const wireResidual = (residual: Uint8Array): Uint8Array => {
  const cached = wireResidualCache.get(residual)
  if (cached) return cached
  const result = computeWireResidual(residual)
  wireResidualCache.set(residual, result)
  return result
}

// Try plain/deflate/brotli on one packed candidate; return the smallest wire form.
const bestWireFor = (packed: Uint8Array): Uint8Array => {
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

// Priority 3/4 (roadmap 1) and Priority 2 (roadmap 2): several residual
// position/value formats compete on ACTUAL post-compression size, not raw
// bytes — split-stream (kind=5) and Rice-coded (kind=6) are never smaller
// than interleaved (kind=2/3/4) in raw bytes, and bitmap (kind=7) trades a
// flat ceil(N/8)-byte cost for no per-error overhead, so which one wins
// depends entirely on the actual error distribution (scattered, clustered,
// dense, ...). RLE (kind=8) specifically targets bursty/clustered errors that
// none of the position-based formats represent compactly. Every applicable
// candidate is compressed and the smallest ACTUAL wire form wins.
const computeWireResidual = (residual: Uint8Array): Uint8Array => {
  let best = bestWireFor(packResidual(residual))

  const candidates = [
    packSplitResidual(residual),
    packRiceResidual(residual),
    packBitmapResidual(residual),
    packRLEResidual(residual),
  ]
  for (const packed of candidates) {
    if (!packed) continue
    const wire = bestWireFor(packed)
    if (wire.length < best.length) best = wire
  }

  return best
}

// ── Prepared chunk types ──────────────────────────────────────────────────────

type PreparedRaw        = { kind: "raw";        chunk: Extract<Chunk, { kind: "raw" }> }
type PreparedLFSR       = { kind: "lfsr";       chunk: Extract<Chunk, { kind: "lfsr" }>;   rWire: Uint8Array }
type PreparedLFSRRef    = { kind: "lfsr-ref";   chunk: Extract<Chunk, { kind: "lfsr" }>;   modelId: number; rWire: Uint8Array }
type PreparedCyclic     = { kind: "cyclic";     chunk: CyclicChunk }
type PreparedApproxCyclic = { kind: "approx-cyclic"; chunk: ApproxCyclicChunk; rWire: Uint8Array }
type PreparedDelta      = { kind: "delta";      chunk: DeltaChunk;      innerBuf: Uint8Array }
type PreparedAffine     = { kind: "affine";     chunk: AffineChunk;     innerBuf: Uint8Array }
type PreparedInterleave = { kind: "interleave"; chunk: InterleaveChunk; laneBufs: Uint8Array[] }
type PreparedBitplane   = { kind: "bitplane";   chunk: BitplaneChunk;   planeBufs: Uint8Array[] }
type PreparedLFSR16     = { kind: "lfsr16";     chunk: LFSR16Chunk;     rWire: Uint8Array }
type PreparedSwitchingLFSR = { kind: "switching-lfsr"; chunk: SwitchingLFSRChunk; rWires: Uint8Array[] }
type Prepared = PreparedRaw | PreparedLFSR | PreparedLFSRRef | PreparedCyclic | PreparedApproxCyclic
              | PreparedDelta | PreparedAffine | PreparedInterleave | PreparedBitplane | PreparedLFSR16
              | PreparedSwitchingLFSR

// ── Simple chunk serialization (used for lane/plane embedding) ────────────────

type PreparedSimple = PreparedRaw | PreparedLFSR | PreparedCyclic | PreparedApproxCyclic

const preparedSimpleSize = (p: PreparedSimple): number => {
  if (p.kind === "raw")           return 1 + 4 + p.chunk.data.length
  if (p.kind === "cyclic")        return 1 + 4 + 2 + p.chunk.cycle.length
  if (p.kind === "approx-cyclic") return 1 + 4 + 2 + p.chunk.cycle.length + p.rWire.length
  const { prefix, lfsr, init } = p.chunk
  return 1 + 4 + 1 + prefix.length + 2 + lfsr.coeffs.length + init.length + p.rWire.length
}

const writeSimpleChunk = (
  buf: Uint8Array, view: DataView,
  p: PreparedSimple,
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
  if (p.kind === "approx-cyclic") {
    buf[off++] = KIND_APPROX_CYCLIC
    view.setUint32(off, p.chunk.originalLength); off += 4
    view.setUint16(off, p.chunk.cycle.length);   off += 2
    buf.set(p.chunk.cycle, off); off += p.chunk.cycle.length
    buf.set(p.rWire, off); off += p.rWire.length
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
  let p: PreparedSimple
  if (chunk.kind === "lfsr")             p = { kind: "lfsr",   chunk, rWire: wireResidual(chunk.residual) }
  else if (chunk.kind === "cyclic")      p = { kind: "cyclic", chunk }
  else if (chunk.kind === "approx-cyclic") p = { kind: "approx-cyclic", chunk, rWire: wireResidual(chunk.residual) }
  else p = { kind: "raw", chunk }
  const buf = new Uint8Array(preparedSimpleSize(p))
  writeSimpleChunk(buf, new DataView(buf.buffer), p, 0)
  return buf
}

// ── General chunk size + write (defined before prepare so prepare can call them) ──

const preparedSize = (p: Prepared): number => {
  if (p.kind === "raw")           return 1 + 4 + p.chunk.data.length
  if (p.kind === "cyclic")        return 1 + 4 + 2 + p.chunk.cycle.length
  if (p.kind === "approx-cyclic") return 1 + 4 + 2 + p.chunk.cycle.length + p.rWire.length
  if (p.kind === "delta")      return 1 + 4 + 1 + 4 + p.innerBuf.length
  if (p.kind === "affine")     return 1 + 4 + 1 + 4 + p.innerBuf.length
  if (p.kind === "interleave") return 1 + 4 + 1 + p.laneBufs.reduce((s, b) => s + 4 + b.length, 0)
  if (p.kind === "bitplane")   return 1 + 4 + 1 + p.planeBufs.reduce((s, b) => s + 4 + b.length, 0)
  if (p.kind === "lfsr16") {
    const L16 = p.chunk.coeffs.length
    return 1 + 4 + 1 + L16 * 2 + L16 * 2 + p.rWire.length
  }
  if (p.kind === "lfsr-ref") {
    const { prefix, init } = p.chunk
    return 1 + 4 + 1 + prefix.length + 2 + init.length + p.rWire.length  // [2]modelId instead of [2]lfsrLen+[L]coeffs
  }
  if (p.kind === "switching-lfsr") {
    return 1 + 4 + 2 + p.chunk.segments.reduce((s, seg, i) => {
      const L = seg.lfsr.length
      return s + 4 + 2 + L + seg.init.length + p.rWires[i]!.length
    }, 0)
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

  if (p.kind === "approx-cyclic") {
    buf[off++] = KIND_APPROX_CYCLIC
    view.setUint32(off, p.chunk.originalLength); off += 4
    view.setUint16(off, p.chunk.cycle.length);   off += 2
    buf.set(p.chunk.cycle, off); off += p.chunk.cycle.length
    buf.set(p.rWire, off); off += p.rWire.length
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

  if (p.kind === "lfsr-ref") {
    const { prefix, init, originalLength } = p.chunk
    buf[off++] = KIND_LFSR_REF
    view.setUint32(off, originalLength); off += 4
    buf[off++] = prefix.length
    buf.set(prefix, off); off += prefix.length
    view.setUint16(off, p.modelId); off += 2
    for (const v of init) buf[off++] = v
    buf.set(p.rWire, off); off += p.rWire.length
    return off - start
  }

  if (p.kind === "switching-lfsr") {
    buf[off++] = KIND_SWITCHING_LFSR
    view.setUint32(off, p.chunk.originalLength); off += 4
    view.setUint16(off, p.chunk.segments.length); off += 2
    p.chunk.segments.forEach((seg, i) => {
      view.setUint32(off, seg.segmentLength); off += 4
      view.setUint16(off, seg.lfsr.length);   off += 2
      for (const c of seg.lfsr.coeffs) buf[off++] = c
      for (const v of seg.init)        buf[off++] = v
      buf.set(p.rWires[i]!, off); off += p.rWires[i]!.length
    })
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

// modelId is only ever set for a TOP-LEVEL chunk that buildModelDictionary chose
// to dedupe — nested calls (lanes, planes, delta/affine inner chunks) never pass
// one, so those keep their coefficients inline regardless of the file dictionary.
const prepare = (chunk: Chunk, modelId?: number): Prepared => {
  if (chunk.kind === "lfsr" && modelId !== undefined)
    return { kind: "lfsr-ref", chunk, modelId, rWire: wireResidual(chunk.residual) }
  if (chunk.kind === "lfsr")       return { kind: "lfsr",       chunk, rWire: wireResidual(chunk.residual) }
  if (chunk.kind === "cyclic")     return { kind: "cyclic",     chunk }
  if (chunk.kind === "approx-cyclic") return { kind: "approx-cyclic", chunk, rWire: wireResidual(chunk.residual) }
  if (chunk.kind === "lfsr16")     return { kind: "lfsr16",     chunk, rWire: wireResidual(chunk.residual) }
  if (chunk.kind === "switching-lfsr")
    return { kind: "switching-lfsr", chunk, rWires: chunk.segments.map(seg => wireResidual(seg.residual)) }
  if (chunk.kind === "affine")     return { kind: "affine",     chunk, innerBuf: serializeSimpleChunk(chunk.inner) }
  // Lanes/planes may be a plain SimpleChunk or one delta transform deep
  // (Priority 6) — serializeChunk handles any Chunk kind, including "delta".
  if (chunk.kind === "interleave") return { kind: "interleave", chunk, laneBufs: chunk.lanes.map(serializeChunk) }
  if (chunk.kind === "bitplane")   return { kind: "bitplane",   chunk, planeBufs: chunk.planes.map(serializeChunk) }
  // DeltaChunk.inner is NonDeltaChunk — may be interleave/bitplane (depth-2), use serializeInnerChunk
  if (chunk.kind === "delta")      return { kind: "delta",      chunk, innerBuf: serializeInnerChunk(chunk.inner) }
  return { kind: "raw", chunk }
}

// ── serialize ─────────────────────────────────────────────────────────────────

export const serialize = (file: CompressedFile): Uint8Array => {
  const { models, refModelId } = buildModelDictionary(file.chunks)
  const useDictionary = models.length > 0

  const prepared   = file.chunks.map((c, i) => prepare(c, refModelId.get(i)))
  const chunkSizes = prepared.map(preparedSize)
  const n          = prepared.length

  const modelTableBytes = useDictionary
    ? 2 + models.reduce((s, m) => s + 2 + m.length, 0)
    : 0

  const chunkPayloadTotal = chunkSizes.reduce((s, cs) => s + cs, 0)
  const totalSize =
    12 +
    modelTableBytes +
    chunkPayloadTotal + n * 4 +
    1 +
    4 + 4 + n * 8 + 4

  const buf  = new Uint8Array(totalSize)
  const view = new DataView(buf.buffer)
  let off = 0

  view.setUint32(off, useDictionary ? MAGIC_V5 : MAGIC_V4); off += 4
  view.setUint32(off, file.originalSize);   off += 4
  view.setUint32(off, n);                   off += 4

  if (useDictionary) {
    view.setUint16(off, models.length); off += 2
    for (const m of models) {
      view.setUint16(off, m.length); off += 2
      for (const c of m.coeffs) buf[off++] = c
    }
  }

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

// PAD5 model table: [2] modelCount, modelCount×{ [2] L, [L] coeffs }. Returns the
// parsed models and bytes consumed, so callers can advance past it before
// reading chunk data.
const readModelTable = (buf: Uint8Array, off: number): [LFSRModelEntry[], number] => {
  const view  = new DataView(buf.buffer, buf.byteOffset)
  const start = off
  const count = view.getUint16(off); off += 2
  const models: LFSRModelEntry[] = []
  for (let i = 0; i < count; i++) {
    const L = view.getUint16(off); off += 2
    models.push({ coeffs: Array.from(buf.subarray(off, off + L)), length: L })
    off += L
  }
  return [models, off - start]
}

// models resolves KIND_LFSR_REF chunks back into fully inline LFSRChunk objects
// (coeffs looked up by modelId) — defaults to empty since only top-level PAD5
// chunks ever reference the dictionary; nested/standalone parses never need it.
const readChunkInner = (
  buf: Uint8Array, off: number, isV4: boolean, models: readonly LFSRModelEntry[] = []
): [ChunkOrSentinel, number] => {
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
    const lanes: LaneChunk[] = []
    for (let j = 0; j < m; j++) {
      const laneLen = view.getUint32(off); off += 4
      const laneBuf = buf.slice(off, off + laneLen); off += laneLen
      lanes.push(readChunkInner(laneBuf, 0, false)[0] as LaneChunk)
    }
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "interleave", m, lanes, originalLength }, off - start]
  }

  if (kind === KIND_BITPLANE) {
    const originalLength = view.getUint32(off); off += 4
    const planeCount = buf[off++]!
    const planes: LaneChunk[] = []
    for (let j = 0; j < planeCount; j++) {
      const planeLen = view.getUint32(off); off += 4
      const planeBuf = buf.slice(off, off + planeLen); off += planeLen
      planes.push(readChunkInner(planeBuf, 0, false)[0] as LaneChunk)
    }
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "bitplane", planes, originalLength }, off - start]
  }

  if (kind === KIND_APPROX_CYCLIC) {
    const originalLength = view.getUint32(off); off += 4
    const period         = view.getUint16(off);  off += 2
    const cycle          = buf.slice(off, off + period); off += period
    const flag = buf[off++]!
    let residual: Uint8Array
    if (flag === RES_BROTLI) {
      const compLen = view.getUint32(off); off += 4
      const plain   = brotliDecompressSync(buf.slice(off, off + compLen)); off += compLen
      ;[residual]   = unpackResidual(plain, 0, originalLength)
    } else if (flag === RES_DEFLATED) {
      const deflLen = view.getUint32(off); off += 4
      const plain   = inflateRawSync(buf.slice(off, off + deflLen)); off += deflLen
      ;[residual]   = unpackResidual(plain, 0, originalLength)
    } else {
      const [res, consumed] = unpackResidual(buf, off, originalLength)
      residual = res; off += consumed
    }
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "approx-cyclic", cycle, residual, originalLength }, off - start]
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

  if (kind === KIND_LFSR_REF) {
    const originalLength = view.getUint32(off);  off += 4
    const prefixLen      = buf[off++]!
    const prefix         = buf.slice(off, off + prefixLen); off += prefixLen
    const modelId        = view.getUint16(off);  off += 2
    const model = models[modelId]
    if (!model) throw new Error(`LFSR ref @${start}: unknown model id ${modelId}`)
    const { coeffs, length: lfsrLen } = model
    const init = Array.from(buf.subarray(off, off + lfsrLen)); off += lfsrLen

    const lfsrRegionLen = originalLength - prefixLen
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
    return [
      { kind: "lfsr", prefix, lfsr: { coeffs, length: lfsrLen }, init, residual, originalLength },
      off - start,
    ]
  }

  if (kind === KIND_SWITCHING_LFSR) {
    const originalLength = view.getUint32(off); off += 4
    const segmentCount   = view.getUint16(off);  off += 2
    const segments: { lfsr: { coeffs: number[]; length: number }; init: number[]; residual: Uint8Array; segmentLength: number }[] = []
    for (let s = 0; s < segmentCount; s++) {
      const segmentLength = view.getUint32(off); off += 4
      const lfsrLen       = view.getUint16(off);  off += 2
      const coeffs = Array.from(buf.subarray(off, off + lfsrLen)); off += lfsrLen
      const init   = Array.from(buf.subarray(off, off + lfsrLen)); off += lfsrLen
      const flag = buf[off++]!
      let residual: Uint8Array
      if (flag === RES_BROTLI) {
        const compLen = view.getUint32(off); off += 4
        const plain   = brotliDecompressSync(buf.slice(off, off + compLen)); off += compLen
        ;[residual]   = unpackResidual(plain, 0, segmentLength)
      } else if (flag === RES_DEFLATED) {
        const deflLen = view.getUint32(off); off += 4
        const plain   = inflateRawSync(buf.slice(off, off + deflLen)); off += deflLen
        ;[residual]   = unpackResidual(plain, 0, segmentLength)
      } else {
        const [res, consumed] = unpackResidual(buf, off, segmentLength)
        residual = res; off += consumed
      }
      segments.push({ lfsr: { coeffs, length: lfsrLen }, init, residual, segmentLength })
    }
    const payloadEnd = off
    if (isV4) { const s = view.getUint32(off); off += 4; const a = crc32(buf.subarray(start, payloadEnd)); if (s !== a) throw new Error(`CRC mismatch @${start}`) }
    return [{ kind: "switching-lfsr", segments, originalLength }, off - start]
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
  const models = view.getUint32(0) === MAGIC_V5 ? readModelTable(buf, 12)[0] : []
  return readChunkInner(buf, chunkStart, true, models)[0] as Chunk
}

// ── deserialize ───────────────────────────────────────────────────────────────

export const deserialize = (buf: Uint8Array): CompressedFile => {
  const view = new DataView(buf.buffer, buf.byteOffset)
  let off = 0

  const magic = view.getUint32(off); off += 4
  const isV4  = magic === MAGIC_V4 || magic === MAGIC_V5
  if (magic !== MAGIC_V3 && magic !== MAGIC_V4 && magic !== MAGIC_V5)
    throw new Error(`Bad magic: expected PADE, PAD4, or PAD5, got 0x${magic.toString(16)}`)

  const originalSize = view.getUint32(off); off += 4
  const chunkCount   = view.getUint32(off); off += 4
  const chunks: CompressedFile["chunks"] = []

  let models: LFSRModelEntry[] = []
  if (magic === MAGIC_V5) { const [m, consumed] = readModelTable(buf, off); models = m; off += consumed }

  if (isV4) {
    for (let i = 0; i < chunkCount; i++) {
      if (off >= buf.length) break
      if (buf[off] === KIND_EOF) break
      const [item, consumed] = readChunkInner(buf, off, true, models)
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
  const isV4  = magic === MAGIC_V4 || magic === MAGIC_V5
  if (magic !== MAGIC_V3 && magic !== MAGIC_V4 && magic !== MAGIC_V5)
    throw new Error(`Bad magic: expected PADE, PAD4, or PAD5, got 0x${magic.toString(16)}`)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _originalSize = view.getUint32(off); off += 4
  const chunkCount    = view.getUint32(off); off += 4

  let models: LFSRModelEntry[] = []
  if (magic === MAGIC_V5) { const [m, consumed] = readModelTable(buf, off); models = m; off += consumed }

  if (isV4) {
    let yielded = 0
    while (yielded < chunkCount && off < buf.length) {
      if (buf[off] === KIND_EOF) break
      const [item, consumed] = readChunkInner(buf, off, true, models)
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
