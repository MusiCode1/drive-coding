// @ts-check
// scripts/pm.mjs — package-manager / runtime resolver.
//
// One resolver so the root scripts run identically under bun (bun-only deploy
// server) and pnpm (dev machine), without duplicating per-PM logic. Detects the
// PM from `npm_config_user_agent` (which every PM injects) and builds the right
// [cmd, args] for "run a script across all workspaces" / "in one workspace".
//
// Runtime-agnostic by design: callers spawn with `process.execPath` (the current
// runtime) rather than a hardcoded `node`. The one intentional exception lives in
// dc-launch.mjs: the BE bin is `#!/usr/bin/env bun` and uses `Bun.*`, so it is
// always spawned with a literal `bun` regardless of the launching PM/runtime.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

/** @typedef {"bun" | "pnpm" | "npm" | "yarn"} Pm */

/**
 * Detect the package manager from `npm_config_user_agent`.
 * Examples: "bun/1.3.14 npm/? node/v24 ..." · "pnpm/10.0.0 npm/? node/v22 ...".
 * Fallback: bun runtime → "bun", else "pnpm" (the project's historical default).
 * @param {string} [ua]
 * @returns {Pm}
 */
export function detectPm(ua = process.env.npm_config_user_agent ?? "") {
  if (ua.startsWith("bun")) return "bun"
  if (ua.startsWith("pnpm")) return "pnpm"
  if (ua.startsWith("yarn")) return "yarn"
  if (ua.startsWith("npm")) return "npm"
  return process.versions.bun ? "bun" : "pnpm"
}

/**
 * [cmd, args] to run `script` in every workspace package. Packages that lack the
 * script are skipped gracefully (verified for bun `--filter '*'` and pnpm `-r run`).
 * @param {string} script
 * @param {{ parallel?: boolean, pm?: Pm }} [opts]
 * @returns {[string, string[]]}
 */
export function runAllArgs(script, { parallel = false, pm = detectPm() } = {}) {
  switch (pm) {
    // bun runs filtered scripts concurrently already — `parallel` is implicit.
    case "bun":
      return ["bun", ["run", "--filter", "*", script]]
    case "pnpm":
      return ["pnpm", parallel ? ["-r", "--parallel", "run", script] : ["-r", "run", script]]
    case "yarn":
      return ["yarn", ["workspaces", "foreach", "-A", ...(parallel ? ["-pi"] : []), "run", script]]
    default:
      return ["npm", ["run", script, "--workspaces", "--if-present"]]
  }
}

/**
 * [cmd, args] to run `script` in a single named workspace package (full name,
 * e.g. "@drive-coding/frontend"). **Assumes the target package HAS the script.**
 * Unlike `runAllArgs("*")` (which skips a script-less package gracefully),
 * `bun run --filter <single-pkg> <missing-script>` fails: "No packages matched" → exit 1.
 * @param {string} pkg
 * @param {string} script
 * @param {Pm} [pm]
 * @returns {[string, string[]]}
 */
export function runFilterArgs(pkg, script, pm = detectPm()) {
  switch (pm) {
    case "bun":
      return ["bun", ["run", "--filter", pkg, script]]
    case "pnpm":
      return ["pnpm", ["--filter", pkg, script]]
    case "yarn":
      return ["yarn", ["workspace", pkg, "run", script]]
    default:
      return ["npm", ["run", script, "--workspace", pkg]]
  }
}

/**
 * Spawn synchronously, inheriting stdio; returns the exit code (throws on ENOENT).
 * @param {string} cmd
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptions} [opts]
 * @returns {number}
 */
export function runPm(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts })
  if (r.error) throw r.error
  return r.status ?? 0
}

// --- CLI: `pm.mjs <verb> ...` ---
const invokedDirectly =
  !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const [verb, a, b] = process.argv.slice(2)
  /** @type {[string, string[]] | undefined} */
  let plan
  if (verb === "run-all") plan = runAllArgs(a)
  else if (verb === "run-all-parallel") plan = runAllArgs(a, { parallel: true })
  else if (verb === "run-filter") plan = runFilterArgs(a, b)
  if (!plan) {
    console.error(`pm.mjs: unknown verb '${verb}' (run-all | run-all-parallel | run-filter)`)
    process.exit(1)
  }
  process.exit(runPm(plan[0], plan[1]))
}
