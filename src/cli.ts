// Simple CLI: compress / decompress / bench / analyze a file
// Usage:
//   tsx src/cli.ts compress  <input>  <output.pade>
//   tsx src/cli.ts decompress <input.pade> <output>
//   tsx src/cli.ts bench     <input>               (compress + verify, no output written)
//   tsx src/cli.ts analyze   <input>               (algebraic structure report)

import { readFileSync, writeFileSync } from "fs"
import { gzipSync } from "zlib"
import { encode, serialize, decompress } from "./index"
import { shannonEntropy } from "./core/entropy"
import { analyzeBuffer, formatAnalysis, toJSON } from "./core/analysis"

// Split argv into flags (--foo) and positional args so flags can appear anywhere
const flags    = new Set(process.argv.slice(2).filter(a => a.startsWith("--")))
const [cmd, src, dst] = process.argv.slice(2).filter(a => !a.startsWith("--"))

if (!cmd || !src) {
  console.error("usage: tsx src/cli.ts <compress|decompress|bench|analyze> [--json] <input> [output]")
  process.exit(1)
}

const input = readFileSync(src)
const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

if (cmd === "decompress") {
  if (!dst) { console.error("decompress requires an output path"); process.exit(1) }
  const out = decompress(bytes)
  writeFileSync(dst, out)
  console.log(`decompressed → ${out.length} bytes`)

} else if (cmd === "compress") {
  if (!dst) { console.error("compress requires an output path"); process.exit(1) }
  const t0   = performance.now()
  const file = encode(bytes)
  const pade = serialize(file)
  const gz   = gzipSync(pade, { level: 9 })
  const out  = gz.length < pade.length ? gz : pade
  const ms   = (performance.now() - t0).toFixed(1)
  writeFileSync(dst, out)

  const ratio = ((out.length / bytes.length) * 100).toFixed(1)
  console.log(`${bytes.length} B → ${out.length} B  (${ratio}%)  in ${ms} ms`)

} else if (cmd === "bench") {
  const t0   = performance.now()
  const file = encode(bytes)
  const pade = serialize(file)
  const gz   = gzipSync(pade, { level: 9 })
  const compressed = gz.length < pade.length ? gz : pade
  const t1   = performance.now()
  const restored   = decompress(compressed)
  const t2   = performance.now()

  const ok = bytes.length === restored.length && bytes.every((b, i) => b === restored[i])

  const kindCounts = new Map<string, number>()
  for (const c of file.chunks) kindCounts.set(c.kind, (kindCounts.get(c.kind) ?? 0) + 1)
  const kindStr = [...kindCounts.entries()].map(([k, n]) => `${n} ${k}`).join("  ")

  console.log(`\nFile:        ${src}`)
  console.log(`Original:    ${bytes.length.toLocaleString()} bytes`)
  console.log(`Compressed:  ${compressed.length.toLocaleString()} bytes  (${((compressed.length / bytes.length) * 100).toFixed(1)}%)`)
  console.log(`Entropy:     ${shannonEntropy(bytes).toFixed(2)} bits/byte`)
  console.log(`Chunks:      ${file.chunks.length} total  (${kindStr})`)
  console.log(`Encode:      ${(t1 - t0).toFixed(1)} ms`)
  console.log(`Decode:      ${(t2 - t1).toFixed(1)} ms`)
  console.log(`Lossless:    ${ok ? "✓" : "✗  BUG"}`)

} else if (cmd === "analyze") {
  const result = analyzeBuffer(bytes, src)
  console.log(flags.has("--json") ? toJSON(result) : formatAnalysis(result))

} else {
  console.error(`unknown command: ${cmd}`)
  process.exit(1)
}
