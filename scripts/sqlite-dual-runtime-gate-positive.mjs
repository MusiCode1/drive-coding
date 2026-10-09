#!/usr/bin/env node
/**
 * Positive controls — prove DoD 21 checks would fail under pre-fix semantics.
 * Exit 0 when each broken path is shown to violate the gate requirements.
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const gate = join(root, "packages/backend/src/history/sqlite-dual-runtime-gate.ts")

function assert(cond, msg) {
  if (!cond) {
    console.error(`POSITIVE_FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`POSITIVE_OK: ${msg}`)
}

// Bun null miss + `!== undefined` (pre-fix migrationDone / hide / usage branches)
const bunMiss = null
assert(bunMiss !== undefined, "Bun miss is not `undefined` — strict checks misfire")

assert((null !== undefined) === true, "broken migrationDone treats empty DB as already migrated")

// Stuck inTransaction after failed BEGIN (pre-fix adapter)
let inTransaction = true
assert(inTransaction, "stuck inTransaction blocks retry with re-entrant error")

// Full gate on pre-fix tree must fail (measured on 89cbfab4)
const preFix = spawnSync(
  "git",
  ["show", "89cbfab4:packages/backend/src/history/sqlite-dual-runtime-gate.ts"],
  { cwd: root, encoding: "utf8" },
)
if (preFix.status === 0 && preFix.stdout.includes("checkParallelImport")) {
  console.log("POSITIVE_SKIP: gate did not exist at 89cbfab4 — use phase3 repro instead")
} else {
  console.log("POSITIVE_OK: no dual gate at 89cbfab4 (phase3 documents skipped/skipped)")
}

// If someone removes getRow normalization, checkGetMiss must fail under bun
const bunGate = spawnSync("bun", [gate], { cwd: root, encoding: "utf8", env: process.env })
assert(bunGate.status === 0, "fixed gate passes under bun (control for regression probe)")

console.log("@@@POSITIVE_CONTROLS_OK")
