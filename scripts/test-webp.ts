import { readFileSync, writeFileSync, existsSync } from "fs"
import { compress, decompress } from "../src/index"

const INPUT  = process.argv[2] ?? "test/test.webp"
const ext    = INPUT.match(/(\.[^.]+)$/)?.[1] ?? ""
const COMPRESSED = "test/compressedFile"
const OUTPUT = `test/decompressedFile${ext}`

if (!existsSync(INPUT)) {
  console.error(`Input not found: ${INPUT}`)
  process.exit(1)
}

const original = new Uint8Array(readFileSync(INPUT))

console.log(`\nInput:       ${INPUT}  (${original.length.toLocaleString()} bytes)`)

const t0 = performance.now()
const compressed = compress(original)
const t1 = performance.now()

writeFileSync(COMPRESSED, compressed)

const ratio = ((compressed.length / original.length) * 100).toFixed(1)
console.log(`Compressed:  ${COMPRESSED}  (${compressed.length.toLocaleString()} bytes  ${ratio}%)`)
console.log(`Encode time: ${(t1 - t0).toFixed(1)} ms`)

const t2 = performance.now()
const restored = decompress(compressed)
const t3 = performance.now()

writeFileSync(OUTPUT, restored)

const match = original.length === restored.length && original.every((b, i) => b === restored[i])

console.log(`Decompressed:${OUTPUT}  (${restored.length.toLocaleString()} bytes)`)
console.log(`Decode time: ${(t3 - t2).toFixed(1)} ms`)
console.log(`Lossless:    ${match ? "✓  byte-perfect" : "✗  MISMATCH — BUG"}`)
