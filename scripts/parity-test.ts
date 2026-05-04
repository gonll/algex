// Parity test: run both C and TS analyzers on the same file and assert they
// agree on key metrics within tolerance.  Prevents silent divergence between
// the two implementations.
//
// Usage:
//   tsx scripts/parity-test.ts [file]
//   npm run parity-test [-- file]

import { execSync } from "child_process"
import { existsSync } from "fs"
import { resolve } from "path"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Metrics {
  structuredPct: number   // e.g. 100.0
  segments:      number   // segment count
  verdict:       string   // raw verdict line (for display)
}

// ── Parsers ───────────────────────────────────────────────────────────────────

const parseStructured = (output: string): number => {
  const m = output.match(/Structured:\s+([\d.]+)%/)
  if (!m) throw new Error("Could not parse 'Structured:' line from output")
  return parseFloat(m[1]!)
}

const parseSegments = (output: string): number => {
  // Matches "Segments (N):" or "Segments (N) (pre-merge):"
  const m = output.match(/Segments\s*\((\d+)\)/)
  if (!m) throw new Error("Could not parse 'Segments (N):' line from output")
  return parseInt(m[1]!, 10)
}

const parseVerdict = (output: string): string => {
  const m = output.match(/Verdict:\s+(.+)/)
  return m ? m[1]!.trim() : "(no verdict found)"
}

const parseMetrics = (output: string): Metrics => ({
  structuredPct: parseStructured(output),
  segments:      parseSegments(output),
  verdict:       parseVerdict(output),
})

// ── Runners ───────────────────────────────────────────────────────────────────

const runC = (file: string): string => {
  const bin = resolve(__dirname, "../c/gf-analyze")
  if (!existsSync(bin)) {
    throw new Error(
      `C binary not found at ${bin}. Run 'make -C c' or 'npm run build:c' first.`
    )
  }
  return execSync(`${bin} "${file}"`, { encoding: "utf8" })
}

const runTS = (file: string): string => {
  const cli = resolve(__dirname, "../src/cli.ts")
  return execSync(`npx tsx "${cli}" analyze "${file}"`, { encoding: "utf8" })
}

// ── Assertions ────────────────────────────────────────────────────────────────

const STRUCTURED_TOL = 5    // ± percentage points
// TS produces pre-merge segments which may be several times more than C's merged count.
// We check that TS segments are at most SEGMENTS_RATIO times C's segments (and not fewer).
const SEGMENTS_RATIO = 4    // TS/C must be in [0.5 .. SEGMENTS_RATIO]

interface CheckResult {
  pass:    boolean
  details: string[]
}

const check = (c: Metrics, ts: Metrics): CheckResult => {
  const details: string[] = []
  let pass = true

  const structDiff = Math.abs(c.structuredPct - ts.structuredPct)
  if (structDiff > STRUCTURED_TOL) {
    pass = false
    details.push(
      `Structured% diff ${structDiff.toFixed(1)}pp exceeds tolerance ${STRUCTURED_TOL}pp` +
      `  (C=${c.structuredPct.toFixed(1)}%  TS=${ts.structuredPct.toFixed(1)}%)`
    )
  }

  // TS produces pre-merge segments; allow it to be up to SEGMENTS_RATIO times
  // C's count, but flag if TS sees drastically fewer (would indicate missed structure).
  const segRatio = c.segments > 0 ? ts.segments / c.segments : 1
  if (segRatio > SEGMENTS_RATIO || segRatio < 0.5) {
    pass = false
    details.push(
      `Segment count ratio ${segRatio.toFixed(2)} outside expected range [0.50..${SEGMENTS_RATIO}.00]` +
      `  (C=${c.segments}  TS=${ts.segments})`
    )
  }

  return { pass, details }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const main = (): void => {
  const file = process.argv[2] ?? "test/gf-structured.bin"
  const absFile = resolve(process.cwd(), file)

  if (!existsSync(absFile)) {
    console.error(`File not found: ${absFile}`)
    process.exit(1)
  }

  console.log(`=== Parity Test: ${file} ===`)

  let cOutput: string
  let tsOutput: string

  try {
    cOutput = runC(absFile)
  } catch (e) {
    console.error(`FAIL: C analyzer error: ${(e as Error).message}`)
    process.exit(1)
  }

  try {
    tsOutput = runTS(absFile)
  } catch (e) {
    console.error(`FAIL: TS analyzer error: ${(e as Error).message}`)
    process.exit(1)
  }

  let cMetrics: Metrics
  let tsMetrics: Metrics

  try {
    cMetrics  = parseMetrics(cOutput)
    tsMetrics = parseMetrics(tsOutput)
  } catch (e) {
    console.error(`FAIL: Parse error: ${(e as Error).message}`)
    process.exit(1)
  }

  console.log(
    `C   : ${cMetrics.structuredPct.toFixed(1)}% structured, ${cMetrics.segments} segments`
  )
  console.log(
    `TS  : ${tsMetrics.structuredPct.toFixed(1)}% structured, ${tsMetrics.segments} segments (pre-merge)`
  )
  console.log(`C   verdict: ${cMetrics.verdict}`)
  console.log(`TS  verdict: ${tsMetrics.verdict}`)

  const { pass, details } = check(cMetrics, tsMetrics)

  if (pass) {
    console.log("PASS: within tolerance")
  } else {
    console.log("FAIL: implementations diverge")
    for (const d of details) console.log(`  ! ${d}`)
    process.exit(1)
  }
}

main()
