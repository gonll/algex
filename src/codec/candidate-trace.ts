// Explainable candidate tracing (roadmap cross-cutting requirement).
//
// Disabled by default and never printed by library code — purely an opt-in
// sink for development/benchmarks to inspect why a given chunk's encoder
// picked the representation it did. Enable, run an encode, read the trace,
// disable (or just let it go out of scope) — see candidate-trace.test.ts for
// the intended usage pattern.

export interface CandidateTraceEntry {
  readonly label: string
  readonly estimatedBytes: number
  readonly actualBytes?: number      // only set for finalists that were actually serialized
  readonly rejectedReason?: string   // e.g. "not a finalist (cheap-estimate cutoff)"
}

export interface ChunkTrace {
  readonly site: string              // which call site produced this: "top-level" | "lane" | "core" | ...
  readonly originalLength: number
  readonly candidates: readonly CandidateTraceEntry[]
  readonly winner: string
}

let tracingEnabled = false
let entries: ChunkTrace[] = []

export const enableCandidateTracing = (): void => { tracingEnabled = true; entries = [] }
export const disableCandidateTracing = (): void => { tracingEnabled = false }
export const isCandidateTracingEnabled = (): boolean => tracingEnabled
export const getCandidateTrace = (): readonly ChunkTrace[] => entries
export const clearCandidateTrace = (): void => { entries = [] }

export const recordChunkTrace = (trace: ChunkTrace): void => {
  if (tracingEnabled) entries.push(trace)
}
