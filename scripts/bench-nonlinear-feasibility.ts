// Roadmap 2, Priority 7: nonlinear recurrence models — feasibility check.
//
// The prototype (src/experimental/nonlinear-recurrence.ts) is correctness-
// verified on synthetic nonlinear data. This checks whether it finds anything
// USEFUL on this project's actual target domain: does any window of the real
// benchmark fixture, or the "raw" chunks the existing linear+transform search
// already gives up on, have a nonlinear order-2 fit the linear search missed?
//
// Prior: this project's target domain (PCIe/USB/SONET PRBS, firmware CRC
// tables, telecom line scramblers) is dominated by hardware that implements
// LINEAR feedback shift registers by construction — nonlinear generators are
// comparatively rare there. Expectation is "prototype works, no real-world
// hits" — an explicitly valid outcome per the roadmap's own acceptance
// criteria for this priority.

import { readFileSync } from "fs"
import { encode } from "../src/codec/encoder"
import { findNonlinearOrder2 } from "../src/experimental/nonlinear-recurrence"

const buf = readFileSync("test/gf-structured.bin")
const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)

const file = encode(bytes)
let rawChunks = 0
let rawBytesTotal = 0
let hits = 0

for (const chunk of file.chunks) {
  if (chunk.kind !== "raw") continue
  rawChunks++
  rawBytesTotal += chunk.data.length
  // Scan bounded, non-overlapping windows within the raw chunk — a full
  // sliding scan would be O(n) solves per byte; this is a feasibility check,
  // not a production search, so a coarse sample is enough to answer the
  // "does this ever help" question.
  const WINDOW = 64
  for (let off = 0; off + WINDOW <= chunk.data.length; off += WINDOW) {
    const result = findNonlinearOrder2(chunk.data.subarray(off, off + WINDOW))
    if (result) hits++
  }
}

console.log(`gf-structured.bin: ${file.chunks.length} chunks, ${rawChunks} raw (${rawBytesTotal} bytes raw)`)
console.log(`nonlinear order-2 hits in raw regions: ${hits}`)
console.log(hits === 0
  ? "No nonlinear structure found beyond what the existing linear search already captures — matches the prior."
  : "Found nonlinear structure the linear search missed — worth a closer look.")
