// Candidate tracing: disabled by default, opt-in, never affects encode output.

import { describe, it, expect, afterEach } from "vitest"
import { gfMul } from "../utils/gf256"
import { encode } from "./encoder"
import {
  enableCandidateTracing, disableCandidateTracing, isCandidateTracingEnabled,
  getCandidateTrace, clearCandidateTrace,
} from "./candidate-trace"

afterEach(() => { disableCandidateTracing(); clearCandidateTrace() })

const makeLfsr = (n: number): Uint8Array => {
  const buf = new Uint8Array(n)
  buf[0] = 1
  for (let i = 1; i < n; i++) buf[i] = gfMul(3, buf[i - 1]!)
  return buf
}

describe("candidate tracing", () => {
  it("is disabled by default — encode records nothing", () => {
    expect(isCandidateTracingEnabled()).toBe(false)
    encode(makeLfsr(2048))
    expect(getCandidateTrace()).toEqual([])
  })

  it("records candidate entries once enabled", () => {
    enableCandidateTracing()
    encode(makeLfsr(2048))
    const trace = getCandidateTrace()
    expect(trace.length).toBeGreaterThan(0)
    const entry = trace[0]!
    expect(typeof entry.site).toBe("string")
    expect(entry.candidates.length).toBeGreaterThan(0)
    expect(typeof entry.winner).toBe("string")
    // The winning candidate should have an actual (real-serialized) size recorded.
    const winnerEntry = entry.candidates.find(c => c.label === entry.winner)
    expect(winnerEntry?.actualBytes).toBeDefined()
  })

  it("stops recording once disabled", () => {
    enableCandidateTracing()
    encode(makeLfsr(2048))
    const countWhileEnabled = getCandidateTrace().length
    expect(countWhileEnabled).toBeGreaterThan(0)

    disableCandidateTracing()
    clearCandidateTrace()
    encode(makeLfsr(2048))
    expect(getCandidateTrace()).toEqual([])
  })

  it("does not change encode output — same result traced or not", () => {
    const buf = makeLfsr(2048)
    const untraced = encode(buf)

    enableCandidateTracing()
    const traced = encode(buf)

    expect(traced).toEqual(untraced)
  })

  it("clearCandidateTrace empties the log without disabling tracing", () => {
    enableCandidateTracing()
    encode(makeLfsr(2048))
    expect(getCandidateTrace().length).toBeGreaterThan(0)
    clearCandidateTrace()
    expect(getCandidateTrace()).toEqual([])
    expect(isCandidateTracingEnabled()).toBe(true)
  })
})
