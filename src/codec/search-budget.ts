// Cost budget manager (roadmap cross-cutting requirement).
//
// As candidate search gets more sophisticated (model-aware chunking, switching
// LFSR segmentation, ...) every new search needs an explicit, deterministic
// bound — not a time-based one, which would make output depend on machine
// speed/load and could differ between the sync and worker-parallel encode
// paths. All bounds here are operation counts, applied identically to every
// chunk regardless of processing order, so sync and async encode stay
// byte-identical for the same input.

export interface SearchBudget {
  // pickBest(): how many cheap-estimate finalists get actually serialized
  // (real deflate/brotli-compressed size) before picking a winner.
  readonly maxExpensiveCandidates: number
  // How many transform levels a composition may nest (e.g. interleave -> delta
  // -> LFSR is depth 2). Bounds runaway composition search.
  readonly maxTransformDepth: number
  // How many approximate LFSR orders (L=1..5) get attempted per chunk before
  // accepting whatever's been found so far.
  readonly maxModelSolves: number
  // Model-aware chunking: how many candidate split points get the expensive
  // (real encode + compare) verification pass, out of however many the cheap
  // model-distance scan proposes.
  readonly maxBoundaryChecks: number
}

export const BUDGETS = {
  fast:     { maxExpensiveCandidates: 2, maxTransformDepth: 1, maxModelSolves: 2, maxBoundaryChecks: 2 },
  balanced: { maxExpensiveCandidates: 4, maxTransformDepth: 2, maxModelSolves: 5, maxBoundaryChecks: 4 },
  max:      { maxExpensiveCandidates: 8, maxTransformDepth: 2, maxModelSolves: 5, maxBoundaryChecks: 8 },
} as const satisfies Record<string, SearchBudget>

export type CompressionMode = keyof typeof BUDGETS

export const DEFAULT_BUDGET: SearchBudget = BUDGETS.balanced
