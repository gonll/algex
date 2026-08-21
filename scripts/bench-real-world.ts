// Validates the codec (and the approx-gate calibration) against genuinely
// real-world data: real ITU-T PRBS test patterns + real compiled binaries
// (test/real-world.bin, see gen-real-world-file.ts), instead of only the
// project's own synthetic byte-level fixture and this session's synthetic
// text+random benchmarks.

import { readFileSync } from "fs"
import { gzipSync, brotliCompressSync, constants } from "zlib"
import { compress, decompress } from "../src/index"

const file = readFileSync("test/real-world.bin")
const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength)

console.log(`input: ${bytes.length} bytes\n`)

const t0 = Date.now()
const codecOut = compress(bytes)
const codecMs = Date.now() - t0
console.log(`codec compress():  ${codecOut.length} bytes (${(codecOut.length / bytes.length * 100).toFixed(1)}%)  [${codecMs}ms]`)

const t1 = Date.now()
const gz = gzipSync(Buffer.from(bytes), { level: 9 })
console.log(`plain gzip -9:      ${gz.length} bytes (${(gz.length / bytes.length * 100).toFixed(1)}%)  [${Date.now() - t1}ms]`)

const t2 = Date.now()
const br = brotliCompressSync(Buffer.from(bytes), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
console.log(`plain brotli-9:     ${br.length} bytes (${(br.length / bytes.length * 100).toFixed(1)}%)  [${Date.now() - t2}ms]`)

const t3 = Date.now()
const br11 = brotliCompressSync(Buffer.from(bytes), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
console.log(`plain brotli-11:    ${br11.length} bytes (${(br11.length / bytes.length * 100).toFixed(1)}%)  [${Date.now() - t3}ms]`)

const roundtrip = decompress(codecOut)
const identical = Buffer.compare(Buffer.from(roundtrip), Buffer.from(bytes)) === 0
console.log(`\nroundtrip: ${identical ? "BYTE-IDENTICAL" : "MISMATCH!!"}`)

// Isolate just the real PRBS region (first 256KB) vs just the real-binary
// region (last ~450KB) to see where the codec's advantage actually lives.
const prbsOnly = bytes.subarray(0, 256 * 1024)
const binOnly = bytes.subarray(256 * 1024)

const prbsCodec = compress(prbsOnly)
const prbsBr = brotliCompressSync(Buffer.from(prbsOnly), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
console.log(`\nreal PRBS7/15/23/31 only (256KB):`)
console.log(`  codec:  ${prbsCodec.length} bytes (${(prbsCodec.length / prbsOnly.length * 100).toFixed(3)}%)`)
console.log(`  brotli: ${prbsBr.length} bytes (${(prbsBr.length / prbsOnly.length * 100).toFixed(3)}%)`)

const binCodec = compress(binOnly)
const binBr = brotliCompressSync(Buffer.from(binOnly), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
console.log(`\nreal compiled binaries only (${(binOnly.length / 1024).toFixed(0)}KB):`)
console.log(`  codec:  ${binCodec.length} bytes (${(binCodec.length / binOnly.length * 100).toFixed(1)}%)`)
console.log(`  brotli: ${binBr.length} bytes (${(binBr.length / binOnly.length * 100).toFixed(1)}%)`)
