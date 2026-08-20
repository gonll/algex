// Cross-platform wrapper for the native c/gf-analyze CLI tool.
//
// npm scripts invoke this as a plain relative path (e.g. "c/gf-analyze"),
// which works fine on macOS/Linux shells but not on Windows: cmd.exe only
// auto-resolves the .exe extension for a *backslash* program path, not a
// forward-slash one, so "c/gf-analyze" fails with "not recognized" even when
// c/gf-analyze.exe exists right there. Resolving and spawning the binary from
// Node sidesteps the shell entirely.

const { spawnSync } = require("child_process")
const { join } = require("path")

const binary = join(__dirname, "..", "c", process.platform === "win32" ? "gf-analyze.exe" : "gf-analyze")
const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" })
process.exit(result.status ?? 1)
