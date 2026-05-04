// Decode pipeline: prefix || xorBytes(predicted, residual) per chunk

import { CompressedFile, LFSR, GFElem } from "../types"
import { fromSeq, xorBytes, concatBytes } from "../utils/buffer"
import { addon } from "../native/addon"
import { DELTA_TRANSFORMS } from "../core/transform"
import { mergeInterleave } from "../utils/interleave"
import { mergeBitplanes } from "../core/bitplane"

const runLFSR = (lfsr: LFSR, init: GFElem[], n: number): GFElem[] =>
  Array.from(addon.lfsrRun(lfsr.coeffs, Buffer.from(init), n))

const decodeChunk = (chunk: CompressedFile["chunks"][number]): Uint8Array => {
  if (chunk.kind === "raw") return chunk.data

  if (chunk.kind === "cyclic") {
    const { cycle, originalLength } = chunk
    const out = new Uint8Array(originalLength)
    for (let i = 0; i < originalLength; i++) out[i] = cycle[i % cycle.length]!
    return out
  }

  if (chunk.kind === "delta") {
    const inner = decodeChunk(chunk.inner)
    const dt = DELTA_TRANSFORMS.find(d => d.id === chunk.deltaId)
    if (!dt) throw new Error(`Unknown delta ID: ${chunk.deltaId}`)
    return dt.invert(inner)
  }

  if (chunk.kind === "affine") {
    const inner = decodeChunk(chunk.inner)
    const out = new Uint8Array(inner.length)
    const k = chunk.k
    for (let i = 0; i < inner.length; i++) out[i] = inner[i]! ^ k
    return out
  }

  if (chunk.kind === "interleave") {
    const decodedLanes = chunk.lanes.map(l => decodeChunk(l))
    return mergeInterleave(decodedLanes, chunk.m)
  }

  if (chunk.kind === "bitplane") {
    return mergeBitplanes(chunk.planes.map(p => decodeChunk(p)))
  }

  if (chunk.kind === "lfsr16") {
    const { coeffs, seed, residual, originalLength } = chunk
    const wordCount = originalLength / 2
    const predicted = addon.lfsr16Run(coeffs, Buffer.from(seed), wordCount)
    const predArr   = new Uint8Array(predicted.buffer, predicted.byteOffset, predicted.byteLength)
    return xorBytes(predArr.subarray(0, originalLength), residual)
  }

  const { prefix, lfsr, init, residual, originalLength } = chunk
  const lfsrRegionLen = originalLength - prefix.length
  const predicted     = fromSeq(runLFSR(lfsr, init, lfsrRegionLen))
  const lfsrRegion    = xorBytes(predicted, residual)

  return prefix.length === 0 ? lfsrRegion : concatBytes([prefix, lfsrRegion])
}

export const decode = (file: CompressedFile): Uint8Array =>
  concatBytes(file.chunks.map(decodeChunk))
