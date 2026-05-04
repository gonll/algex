// Worker thread entry point for parallel chunk encoding.
// Receives raw chunk bytes, encodes them, returns serialized chunk bytes.
// Imported lazily by worker-pool so the heavy GF tables only load in workers.

import { parentPort } from "worker_threads"
import { encodeChunk } from "./encoder"
import { serializeChunk } from "./format"

parentPort!.on("message", ({ id, buffer }: { id: number; buffer: ArrayBuffer }) => {
  const bytes      = new Uint8Array(buffer)
  const chunk      = encodeChunk(bytes)
  const serialized = serializeChunk(chunk)
  // Transfer the ArrayBuffer back to avoid copying
  parentPort!.postMessage({ id, serialized: serialized.buffer }, [serialized.buffer as ArrayBuffer])
})
