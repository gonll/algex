// Compact residual serialization: empty / sparse (position-value pairs) / dense.
// Sparse wins when fewer than ~33% of bytes are non-zero (break-even at k*3 = N).
//
// kind=0: empty  (all zeros)
// kind=1: dense  [4] byteCount, [N] bytes
// kind=2: sparse [2] pairCount, [k×3] uint16-pos + uint8-val  (positions ≤ 65535)
// kind=3: sparse [4] pairCount, [k×5] uint32-pos + uint8-val  (large residuals)
// kind=4: VarInt [2] pairCount, [k×(1|2)+1] VarInt-delta-pos + uint8-val
//         VarInt: gap < 128 → 1 byte; gap 128–16383 → 2 bytes ([gap&0x7F|0x80, gap>>7])

import { isAllZero } from "./buffer"

export type ResidualKind = 0 | 1 | 2 | 3 | 4

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
    const varintData = pairs.reduce((acc, [pos], i) => {
      const delta = pos - (i > 0 ? pairs[i - 1]![0] : 0)
      return acc + varintByteLen(delta) + 1  // VarInt pos + uint8 val
    }, 0)
    kind4Size = 1 + 2 + varintData  // kind byte + uint16 pairCount + data
  }

  const bestSparse = Math.min(sparseSize, kind4Size)

  if (bestSparse < denseSize) {
    if (!needsLarge && kind4Size < sparseSize) {
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
