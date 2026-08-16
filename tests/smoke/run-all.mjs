#!/usr/bin/env node
/**
 * run-all.mjs — orchestrates every smoke test in this folder.
 *
 * Each smoke test is a standalone `*.mjs` file in `tests/smoke/`. The runner:
 *   1. Discovers every `*.mjs` file except itself.
 *   2. Spawns `node <test>` sequentially (BE has shared state — sessions
 *      accumulate, so parallelism would mask race bugs).
 *   3. Captures the test's exit code AND its `RESULT: {...}` line (per the
 *      smoke convention in README.md).
 *   4. Prints a per-test summary, then a final aggregate `RESULT: {...}`.
 *
 * Sequential, not parallel: the BE accumulates sessions and does not scale
 * under concurrent smoke runs.
 *
 * Pre-conditions: BE on :4000 (via OneCLI) + FE on :5173. Each child smoke
 * inherits this env, so no special handling here.
 *
 * Exit 0 = every test passed, exit 1 = at least one failed (or crashed).
 *
 * Env overrides: each test honors its own env (FE_URL, CWD, etc). Override at
 * the runner level and they propagate down.
 *
 * Usage:
 *   cd tests/smoke && node run-all.mjs
 *   cd tests/smoke && npm test       # alias
 */

import { readdirSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const SELF = path.basename(fileURLToPath(import.meta.url))

const tests = readdirSync(dir)
  .filter((f) => f.endsWith(".mjs") && f !== SELF)
  .sort()

if (tests.length === 0) {
  console.error("no smoke tests found")
  process.exit(1)
}

console.log(`=== run-all: ${tests.length} tests ===`)

/**
 * Run a single smoke test as `node <file>` and return its summary.
 * Streams stdout/stderr live (prefixed) so failures are visible immediately.
 */
function runOne(file) {
  return new Promise((resolve) => {
    const start = Date.now()
    const child = spawn(process.execPath, [path.join(dir, file)], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    const prefix = `  [${file}] `
    child.stdout.on("data", (chunk) => {
      const s = chunk.toString()
      stdout += s
      process.stdout.write(prefix + s.replace(/\n(?!$)/g, "\n" + prefix))
    })
    child.stderr.on("data", (chunk) => {
      process.stderr.write(prefix + chunk.toString().replace(/\n(?!$)/g, "\n" + prefix))
    })

    child.on("error", (err) => {
      resolve({ file, ok: false, exitCode: -1, ms: Date.now() - start, result: null, error: err.message })
    })
    child.on("close", (code) => {
      // Parse the last `RESULT: {...}` line per smoke convention.
      let result = null
      const m = stdout.match(/^RESULT: (.+)$/m)
      if (m) {
        try {
          result = JSON.parse(m[1])
        } catch {
          /* leave as null */
        }
      }
      resolve({
        file,
        ok: code === 0,
        exitCode: code ?? -1,
        ms: Date.now() - start,
        result,
      })
    })
  })
}

const summaries = []
for (const t of tests) {
  console.log(`\n--- ${t} ---`)
  const s = await runOne(t)
  summaries.push(s)
  console.log(`  → ${s.ok ? "PASS" : "FAIL"} (${s.exitCode}) in ${s.ms}ms`)
}

const ok = summaries.every((s) => s.ok)
const passed = summaries.filter((s) => s.ok).length

console.log("\n=== Summary ===")
for (const s of summaries) {
  console.log(`  ${s.ok ? "✓" : "✗"} ${s.file}  (${s.ms}ms)`)
}
console.log(`\n${passed}/${summaries.length} passed`)

console.log(
  "RESULT: " +
    JSON.stringify({
      ok,
      total: summaries.length,
      passed,
      tests: summaries.map((s) => ({
        file: s.file,
        ok: s.ok,
        exitCode: s.exitCode,
        ms: s.ms,
        result: s.result,
      })),
    }),
)

process.exit(ok ? 0 : 1)
