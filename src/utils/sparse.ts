// Compact residual serialization: empty / sparse (position-value pairs) / dense
// / split streams. Sparse wins when fewer than ~33% of bytes are non-zero
// (break-even at k*3 = N).
//
// kind=0: empty  (all zeros)
// kind=1: dense  [4] byteCount, [N] bytes
// kind=2: sparse [2] pairCount, [k×3] uint16-pos + uint8-val  (positions ≤ 65535)
// kind=3: sparse [4] pairCount, [k×5] uint32-pos + uint8-val  (large residuals)
// kind=4: VarInt [2] pairCount, [k×(1|2)+1] VarInt-delta-pos + uint8-val
//         VarInt: gap < 128 → 1 byte; gap 128–16383 → 2 bytes ([gap&0x7F|0x80, gap>>7])
// kind=5: split  [2] pairCount, [2] posStreamLen, [posStreamLen] VarInt-delta
//         positions, [pairCount] values — positions and values in separate
//         contiguous streams instead of interleaved pairs. Same VarInt delta
//         coding as kind=4 for positions; values are one byte each, un-interleaved
//         so the two streams' independent statistics aren't diluted by each other
//         (matters most once the caller's outer deflate/brotli pass runs over
//         the whole packed blob — each homogeneous region compresses better alone).
// kind=6: Rice   [2] pairCount, [1] k, [4] posBitLen, [ceil(posBitLen/8)] Rice(k)
//         -coded delta positions (bit-packed, not byte-aligned per gap),
//         [pairCount] values. Rice/Golomb coding beats VarInt's fixed 1-or-2-byte
//         granularity when the gap distribution is roughly geometric (the common
//         case for uniformly-scattered sparse errors) — see bestRiceK below.
// kind=7: bitmap [ceil(N/8)] presence bits (N = the caller-supplied residual
//         length), [popcount] values for the set bits in position order. No
//         header needed beyond the kind byte — N comes from context and the
//         value count is just however many bits are set. Wins in the density
//         range (roughly 30-60%) where per-error position/value pairs cost
//         more than a flat 1 bit/position, but dense byte storage (kind=1)
//         still wastes a full byte on every zero.
// kind=8: RLE    [2] runCount, runCount VarInt run lengths (alternating
//         zero-run, non-zero-run, starting with a zero-run — length 0 if the
//         residual itself starts non-zero), then one value byte per byte
//         covered by a non-zero run, in order. Wins when errors cluster into
//         contiguous bursts rather than scattering — one run beats many
//         individual (position, value) pairs.

import { isAllZero } from "./buffer"

export type ResidualKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

// Compute the VarInt-encoded byte count for a gap value.
// Gaps < 128 fit in 1 byte; gaps 128–16383 fit in 2 bytes.
// Gaps >= 16384 are not supported by kind=4 (fall through to kind=2/3).
const varintByteLen = (gap: number): number => gap < 128 ? 1 : 2

// Write a VarInt gap into buf at offset; returns bytes written.
const writeVarint = (buf: Uint8Array, off: number, gap: number): number => {
  if (gap < 128) { buf[off] = gap; return 1 }
  buf[off]     = (gap & 0x7F) | 0x80
  buf[off + 1] = gap >> 7
  return 2
}

// Total VarInt bytes for delta-encoded positions (no interleaved value byte —
// shared by kind=4's per-pair sizing and kind=5's position-stream-only sizing).
const varintPositionBytes = (pairs: readonly [number, number][]): number => {
  let total = 0, prev = 0
  for (const [pos] of pairs) { total += varintByteLen(pos - prev); prev = pos }
  return total
}

// kind=5 candidate: split position/value streams. Its raw packed size is always
// 2 bytes larger than kind=4's identical content (the extra posStreamLen field),
// so it can never win a same-representation raw-size comparison — its entire
// value proposition is that separating the two streams' statistics lets a
// downstream general-purpose compressor (deflate/brotli) do better than it would
// on the interleaved kind=4 layout. That can only be judged by actually
// compressing both and comparing, so this is exposed separately for the caller
// (format.ts's wireResidual) to try alongside packResidual's winner, rather than
// competing here on raw size where it would always lose.
// Below this many pairs there isn't enough repeated structure in either stream
// for a compressor to plausibly recover the 2-byte header tax — skip the second
// compression pass entirely rather than pay for a comparison that can't win.
const MIN_PAIRS_FOR_SPLIT = 8

export const packSplitResidual = (residual: Uint8Array): Uint8Array | null => {
  const pairs: [number, number][] = []
  residual.forEach((v, i) => { if (v !== 0) pairs.push([i, v]) })
  if (pairs.length < MIN_PAIRS_FOR_SPLIT || pairs.length > 65535) return null
  if (pairs[pairs.length - 1]![0] > 65535) return null

  const posBytes = varintPositionBytes(pairs)
  const size = 1 + 2 + 2 + posBytes + pairs.length
  const buf  = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  buf[0] = 5
  view.setUint16(1, pairs.length)
  view.setUint16(3, posBytes)
  let wOff = 5
  let prev = 0
  for (const [pos] of pairs) { wOff += writeVarint(buf, wOff, pos - prev); prev = pos }
  for (const [, val] of pairs) buf[wOff++] = val
  return buf
}

// ── Rice/Golomb coding for sparse residual positions (kind=6) ────────────────

// Generous upper bound on the search range for k — gap magnitudes in this
// codec are bounded by chunk size (well under 2^20), so k never needs to exceed
// this in practice; it just bounds the search loop.
const RICE_MAX_K = 20

class BitWriter {
  private bytes: number[] = []
  private cur = 0
  private nBits = 0

  writeBits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >>> i) & 1)
      this.nBits++
      if (this.nBits === 8) { this.bytes.push(this.cur); this.cur = 0; this.nBits = 0 }
    }
  }

  writeUnary(q: number): void {
    for (let i = 0; i < q; i++) this.writeBits(1, 1)
    this.writeBits(0, 1)
  }

  get bitLength(): number { return this.bytes.length * 8 + this.nBits }

  finish(): Uint8Array {
    const out = this.bytes.slice()
    if (this.nBits > 0) out.push(this.cur << (8 - this.nBits))
    return Uint8Array.from(out)
  }
}

class BitReader {
  private bitPos = 0
  constructor(private buf: Uint8Array, private startByte: number) {}

  private readBit(): number {
    const bitIdx  = this.bitPos++
    const byteIdx = this.startByte + (bitIdx >> 3)
    const shift   = 7 - (bitIdx & 7)
    return (this.buf[byteIdx]! >> shift) & 1
  }

  readBits(count: number): number {
    let v = 0
    for (let i = 0; i < count; i++) v = (v << 1) | this.readBit()
    return v >>> 0
  }

  // maxQ bounds the unary run so a corrupt/malformed stream (all-ones) can't
  // scan unbounded memory — it throws instead of looping past what any valid
  // gap for this residual's length could ever produce.
  readUnary(maxQ: number): number {
    let q = 0
    while (this.readBit() === 1) {
      q++
      if (q > maxQ) throw new Error("Rice-coded unary run exceeds bound — corrupt data")
    }
    return q
  }
}

// Exact total bit cost of Rice-coding `gaps` with parameter k — no allocation,
// used to search for the best k before committing to a bit-writer pass.
const riceBitCost = (gaps: readonly number[], k: number): number => {
  let bits = gaps.length * (1 + k)  // 1 terminator bit + k remainder bits, per gap
  for (const g of gaps) bits += g >>> k
  return bits
}

// Search k in [0, RICE_MAX_K] for the smallest total encoded size. Cost is
// convex in k around the optimum (too-small k → long unary runs; too-large k →
// wasted remainder bits), so bail out once it's clearly climbing again.
const bestRiceK = (gaps: readonly number[]): number => {
  let bestK = 0, bestBits = Infinity
  for (let k = 0; k <= RICE_MAX_K; k++) {
    const bits = riceBitCost(gaps, k)
    if (bits < bestBits) { bestBits = bits; bestK = k }
    else if (bits > bestBits * 1.5) break
  }
  return bestK
}

// Same pair-count floor as packSplitResidual — below this there isn't enough
// data for Rice's bit-packing to plausibly beat VarInt's byte granularity.
const MIN_PAIRS_FOR_RICE = 8

export const packRiceResidual = (residual: Uint8Array): Uint8Array | null => {
  const pairs: [number, number][] = []
  residual.forEach((v, i) => { if (v !== 0) pairs.push([i, v]) })
  if (pairs.length < MIN_PAIRS_FOR_RICE || pairs.length > 65535) return null

  const gaps: number[] = []
  let prev = 0
  for (const [pos] of pairs) { gaps.push(pos - prev); prev = pos }

  const k = bestRiceK(gaps)
  const writer = new BitWriter()
  const mask = (1 << k) - 1
  for (const g of gaps) {
    writer.writeUnary(g >>> k)
    if (k > 0) writer.writeBits(g & mask, k)
  }
  const posBits  = writer.bitLength
  const posBytes = writer.finish()

  const size = 1 + 2 + 1 + 4 + posBytes.length + pairs.length
  const buf  = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  buf[0] = 6
  view.setUint16(1, pairs.length)
  buf[3] = k
  view.setUint32(4, posBits)
  buf.set(posBytes, 8)
  let wOff = 8 + posBytes.length
  for (const [, val] of pairs) buf[wOff++] = val
  return buf
}

// ── Bitmap (kind=7) — roadmap 2, Priority 2 ──────────────────────────────────

// Below this length a presence bitmap's flat ceil(N/8)-byte cost can't compete
// with sparse formats' per-error cost even in the best case.
const MIN_LENGTH_FOR_BITMAP = 32

export const packBitmapResidual = (residual: Uint8Array): Uint8Array | null => {
  const n = residual.length
  if (n < MIN_LENGTH_FOR_BITMAP) return null

  let popcount = 0
  for (let i = 0; i < n; i++) if (residual[i] !== 0) popcount++
  if (popcount === 0) return null  // all-zero handled by kind=0 upstream

  const bitmapBytes = Math.ceil(n / 8)
  const buf = new Uint8Array(1 + bitmapBytes + popcount)
  buf[0] = 7
  let vOff = 1 + bitmapBytes
  for (let i = 0; i < n; i++) {
    if (residual[i] !== 0) {
      buf[1 + (i >> 3)]! |= 1 << (i & 7)
      buf[vOff++] = residual[i]!
    }
  }
  return buf
}

// ── RLE (kind=8) — roadmap 2, Priority 2 ─────────────────────────────────────

const MIN_LENGTH_FOR_RLE = 16

export const packRLEResidual = (residual: Uint8Array): Uint8Array | null => {
  const n = residual.length
  if (n < MIN_LENGTH_FOR_RLE) return null

  // Alternating zero-run / non-zero-run lengths, starting with a zero-run
  // (length 0 if residual[0] is itself non-zero).
  const runLengths: number[] = []
  const values: number[] = []
  let i = 0
  let wantZero = true
  while (i < n) {
    const start = i
    if (wantZero) {
      while (i < n && residual[i] === 0) i++
    } else {
      while (i < n && residual[i] !== 0) { values.push(residual[i]!); i++ }
    }
    runLengths.push(i - start)
    wantZero = !wantZero
  }
  // All-zero or all-non-zero — kind=0/kind=1 already own those cases; RLE
  // needs at least one real zero run and one real non-zero run to have
  // anything to compress (a leading/trailing zero-length run still leaves
  // runLengths.length >= 2, so check the actual value count instead).
  if (values.length === 0 || values.length === n) return null
  if (runLengths.length > 65535) return null
  // writeVarint's 2-byte form only safely represents gaps up to 32767 (7 bits
  // + a full byte); a merged chunk's residual (mergeCompatibleChunks
  // concatenates adjacent same-model chunks) can be arbitrarily long, so a
  // single run could exceed that. Bail out to another format rather than
  // silently truncating.
  if (runLengths.some(len => len > 32767)) return null

  let dataBytes = 0
  for (const len of runLengths) dataBytes += varintByteLen(len)

  const size = 1 + 2 + dataBytes + values.length
  const buf  = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  buf[0] = 8
  view.setUint16(1, runLengths.length)
  let off = 3
  for (const len of runLengths) off += writeVarint(buf, off, len)
  buf.set(values, off)
  return buf
}

export const packResidual = (residual: Uint8Array): Uint8Array => {
  if (isAllZero(residual)) return new Uint8Array([0])

  const pairs: [number, number][] = []
  residual.forEach((v, i) => { if (v !== 0) pairs.push([i, v]) })

  const needsLarge = pairs.length > 65535 || (pairs.length > 0 && pairs[pairs.length - 1]![0] > 65535)
  const sparseSize = needsLarge
    ? 1 + 4 + pairs.length * 5   // kind=3: uint32 pairCount, uint32 pos, uint8 val
    : 1 + 2 + pairs.length * 3   // kind=2: uint16 pairCount, uint16 pos, uint8 val
  const denseSize = 1 + 4 + residual.length

  // kind=4: VarInt delta positions — only viable when positions fit in uint16 range
  let kind4Size = Infinity
  if (!needsLarge && pairs.length <= 65535) {
    kind4Size = 1 + 2 + varintPositionBytes(pairs) + pairs.length  // kind byte + uint16 pairCount + (pos+val) interleaved
  }

  const bestSize = Math.min(sparseSize, kind4Size, denseSize)

  if (bestSize === kind4Size && kind4Size < denseSize) {
    // Emit kind=4: VarInt delta positions
    const buf  = new Uint8Array(kind4Size)
    const view = new DataView(buf.buffer)
    buf[0] = 4
    view.setUint16(1, pairs.length)
    let wOff = 3
    let prev4 = 0
    for (const [pos, val] of pairs) {
      const delta = pos - prev4
      wOff += writeVarint(buf, wOff, delta)
      buf[wOff++] = val
      prev4 = pos
    }
    return buf
  }

  if (bestSize === sparseSize && sparseSize < denseSize) {
    const buf  = new Uint8Array(sparseSize)
    const view = new DataView(buf.buffer)
    if (needsLarge) {
      buf[0] = 3
      view.setUint32(1, pairs.length)
      let prev3 = 0
      pairs.forEach(([pos, val], i) => {
        view.setUint32(5 + i * 5, pos - prev3)
        buf[5 + i * 5 + 4] = val
        prev3 = pos
      })
    } else {
      buf[0] = 2
      view.setUint16(1, pairs.length)
      let prev2 = 0
      pairs.forEach(([pos, val], i) => {
        view.setUint16(3 + i * 3, pos - prev2)
        buf[3 + i * 3 + 2] = val
        prev2 = pos
      })
    }
    return buf
  }

  const buf = new Uint8Array(denseSize)
  const view = new DataView(buf.buffer)
  buf[0] = 1
  view.setUint32(1, residual.length)
  buf.set(residual, 5)
  return buf
}

// Estimated packed size without allocating — used for encoder size gate
export const packedResidualSize = (residual: Uint8Array): number => {
  let nonZeroCount = 0
  let maxPos = 0
  let prevPos = 0
  let varintDataSize = 0
  for (let i = 0; i < residual.length; i++) {
    if (residual[i] !== 0) {
      const delta = i - prevPos
      varintDataSize += varintByteLen(delta) + 1
      prevPos = i
      nonZeroCount++
      maxPos = i
    }
  }
  if (nonZeroCount === 0) return 1
  const needsLarge = nonZeroCount > 65535 || maxPos > 65535
  const sparseSize = needsLarge
    ? 1 + 4 + nonZeroCount * 5
    : 1 + 2 + nonZeroCount * 3
  const kind4Size = needsLarge ? Infinity : 1 + 2 + varintDataSize
  return Math.min(sparseSize, kind4Size, 1 + 4 + residual.length)
}

// Read from buf at offset; returns [decoded residual, bytes consumed]
export const unpackResidual = (
  buf: Uint8Array,
  off: number,
  lfsrRegionLen: number
): [Uint8Array, number] => {
  const kind = buf[off] as ResidualKind
  if (kind === 0) return [new Uint8Array(0), 1]

  const view = new DataView(buf.buffer, buf.byteOffset)

  if (kind === 1) {
    const len = view.getUint32(off + 1)
    return [buf.slice(off + 5, off + 5 + len), 5 + len]
  }

  if (kind === 2) {
    const pairCount = view.getUint16(off + 1)
    const residual  = new Uint8Array(lfsrRegionLen)
    let runPos2 = 0
    for (let i = 0; i < pairCount; i++) {
      runPos2 += view.getUint16(off + 3 + i * 3)
      residual[runPos2] = buf[off + 3 + i * 3 + 2]!
    }
    return [residual, 3 + pairCount * 3]
  }

  if (kind === 4) {
    // VarInt delta-coded positions + uint8 values
    const pairCount = view.getUint16(off + 1)
    const residual  = new Uint8Array(lfsrRegionLen)
    let rOff = off + 3
    let pos4 = 0
    for (let i = 0; i < pairCount; i++) {
      // Decode VarInt delta
      let delta = 0
      const b0 = buf[rOff++]!
      if (b0 & 0x80) {
        const b1 = buf[rOff++]!
        delta = (b0 & 0x7F) | (b1 << 7)
      } else {
        delta = b0
      }
      pos4 += delta
      residual[pos4] = buf[rOff++]!
    }
    return [residual, rOff - off]
  }

  if (kind === 5) {
    // Split streams: VarInt delta positions, then one value byte per position.
    const pairCount   = view.getUint16(off + 1)
    const posStreamLen = view.getUint16(off + 3)
    const residual    = new Uint8Array(lfsrRegionLen)
    const positions   = new Array<number>(pairCount)
    let rOff = off + 5
    const posStreamEnd = rOff + posStreamLen
    let pos5 = 0
    for (let i = 0; i < pairCount; i++) {
      let delta = 0
      const b0 = buf[rOff++]!
      if (b0 & 0x80) {
        const b1 = buf[rOff++]!
        delta = (b0 & 0x7F) | (b1 << 7)
      } else {
        delta = b0
      }
      pos5 += delta
      positions[i] = pos5
    }
    rOff = posStreamEnd
    for (let i = 0; i < pairCount; i++) residual[positions[i]!] = buf[rOff++]!
    return [residual, rOff - off]
  }

  if (kind === 6) {
    const pairCount = view.getUint16(off + 1)
    const k         = buf[off + 3]!
    const posBits   = view.getUint32(off + 4)
    const posByteLen = Math.ceil(posBits / 8)
    const residual  = new Uint8Array(lfsrRegionLen)
    const positions = new Array<number>(pairCount)
    const reader    = new BitReader(buf, off + 8)
    // A valid gap can span at most the residual's own length, so this bounds the
    // largest legitimate unary run — anything beyond it means corrupt input.
    const maxQ = Math.max(1, (lfsrRegionLen >>> k) + 2)
    let pos = 0
    for (let i = 0; i < pairCount; i++) {
      const q = reader.readUnary(maxQ)
      const r = k > 0 ? reader.readBits(k) : 0
      pos += q * (1 << k) + r
      positions[i] = pos
    }
    let rOff = off + 8 + posByteLen
    for (let i = 0; i < pairCount; i++) residual[positions[i]!] = buf[rOff++]!
    return [residual, rOff - off]
  }

  if (kind === 7) {
    const bitmapBytes = Math.ceil(lfsrRegionLen / 8)
    const residual    = new Uint8Array(lfsrRegionLen)
    let vOff = off + 1 + bitmapBytes
    for (let i = 0; i < lfsrRegionLen; i++) {
      const byte = buf[off + 1 + (i >> 3)]!
      if ((byte >> (i & 7)) & 1) residual[i] = buf[vOff++]!
    }
    return [residual, vOff - off]
  }

  if (kind === 8) {
    const runCount = view.getUint16(off + 1)
    const residual = new Uint8Array(lfsrRegionLen)
    let rOff = off + 3
    const runLengths = new Array<number>(runCount)
    for (let i = 0; i < runCount; i++) {
      const b0 = buf[rOff++]!
      if (b0 & 0x80) { const b1 = buf[rOff++]!; runLengths[i] = (b0 & 0x7F) | (b1 << 7) }
      else runLengths[i] = b0
    }
    let pos = 0
    let isZeroRun = true
    for (const len of runLengths) {
      if (!isZeroRun) for (let k = 0; k < len; k++) residual[pos + k] = buf[rOff++]!
      pos += len
      isZeroRun = !isZeroRun
    }
    return [residual, rOff - off]
  }

  // kind === 3: large sparse with delta-encoded uint32 gaps
  const pairCount = view.getUint32(off + 1)
  const residual  = new Uint8Array(lfsrRegionLen)
  let runPos3 = 0
  for (let i = 0; i < pairCount; i++) {
    runPos3 += view.getUint32(off + 5 + i * 5)
    residual[runPos3] = buf[off + 5 + i * 5 + 4]!
  }
  return [residual, 5 + pairCount * 5]
}
