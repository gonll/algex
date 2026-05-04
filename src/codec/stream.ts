// Node.js Transform stream wrappers for compress / decompress pipelines.
//
// Usage:
//   import { pipeline } from "stream/promises"
//   await pipeline(fs.createReadStream(src), createCompressStream(), fs.createWriteStream(dst))
//
// The current implementation buffers the full input before flushing — sufficient
// for files that fit in memory.  True chunk-boundary streaming would require
// fixing the chunk size so boundaries can be emitted incrementally.

import { Transform, TransformCallback } from "stream"
import { compress, decompress }         from "../index"

export const createCompressStream = (): Transform => {
  const parts: Buffer[] = []
  return new Transform({
    transform(chunk: Buffer, _enc: string, cb: TransformCallback) {
      parts.push(chunk); cb()
    },
    flush(cb: TransformCallback) {
      try {
        this.push(Buffer.from(compress(new Uint8Array(Buffer.concat(parts)))))
        cb()
      } catch (e) { cb(e as Error) }
    },
  })
}

export const createDecompressStream = (): Transform => {
  const parts: Buffer[] = []
  return new Transform({
    transform(chunk: Buffer, _enc: string, cb: TransformCallback) {
      parts.push(chunk); cb()
    },
    flush(cb: TransformCallback) {
      try {
        this.push(Buffer.from(decompress(new Uint8Array(Buffer.concat(parts)))))
        cb()
      } catch (e) { cb(e as Error) }
    },
  })
}
