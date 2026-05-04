import { compress, decompress }          from "../src/index"
import { createCompressStream, createDecompressStream } from "../src/codec/stream"
import { readFileSync }                  from "fs"
import { availableParallelism }          from "os"

const bytes = new Uint8Array(readFileSync("test/gf-structured.bin"))

const streamRoundtrip = (input: Buffer): Promise<{ compressed: Buffer; restored: Buffer }> =>
  new Promise((resolve, reject) => {
    const cParts: Buffer[] = []
    const cs = createCompressStream()
    cs.on("data", (c: Buffer) => cParts.push(c))
    cs.on("error", reject)
    cs.on("finish", () => {
      const compressed = Buffer.concat(cParts)
      const dParts: Buffer[] = []
      const ds = createDecompressStream()
      ds.on("data", (c: Buffer) => dParts.push(c))
      ds.on("error", reject)
      ds.on("finish", () => resolve({ compressed, restored: Buffer.concat(dParts) }))
      ds.end(compressed)
    })
    cs.end(input)
  });

(async () => {
  console.log(`\nCores available: ${availableParallelism()}`)
  console.log(`Input:  ${bytes.length.toLocaleString()} bytes\n`)

  // ── Synchronous baseline ──
  const t0 = performance.now()
  const syncComp = compress(bytes)
  const t1 = performance.now()
  const syncOk = decompress(syncComp).every((b, i) => b === bytes[i])
  console.log(`Sync:    ${syncComp.length.toLocaleString()} B  (${((syncComp.length/bytes.length)*100).toFixed(1)}%)  ${(t1-t0).toFixed(0)} ms  lossless: ${syncOk ? "✓" : "✗"}`)

  // ── Async worker pool ──
  const { compressAsync } = await import("../src/index")
  const t2 = performance.now()
  const asyncComp = await compressAsync(bytes)
  const t3 = performance.now()
  const asyncOk = decompress(asyncComp).every((b, i) => b === bytes[i])
  console.log(`Workers: ${asyncComp.length.toLocaleString()} B  (${((asyncComp.length/bytes.length)*100).toFixed(1)}%)  ${(t3-t2).toFixed(0)} ms  lossless: ${asyncOk ? "✓" : "✗"}`)

  // ── Streaming API ──
  const t4 = performance.now()
  const { compressed, restored } = await streamRoundtrip(Buffer.from(bytes))
  const t5 = performance.now()
  const streamOk = bytes.every((b, i) => b === restored[i])
  console.log(`Stream:  ${compressed.length.toLocaleString()} B  (${((compressed.length/bytes.length)*100).toFixed(1)}%)  ${(t5-t4).toFixed(0)} ms  lossless: ${streamOk ? "✓" : "✗"}`)
})()
