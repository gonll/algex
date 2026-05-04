// Plain CJS shim: registers the tsx TypeScript loader then delegates to the TS worker.
// This lets worker-pool.ts spawn a plain .cjs file (no special execArgv needed).
require('tsx/cjs')
require('./worker-entry.ts')
