#!/usr/bin/env node
/**
 * DoD 21 — run sqlite-dual-runtime-gate.ts under Bun and Node (10× each, all must pass).
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const gateTs = join(root, "packages/backend/src/history/sqlite-dual-runtime-gate.ts")
const gateJs = join(root, "packages/backend/dist/history/sqlite-dual-runtime-gate.js")
const RUNS = 10

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: "pipe" })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
  console.log(`--- ${label} ---`)
  if (out) console.log(out)
  if (r.status !== 0) {
    console.error(`@@@GATE_FAIL ${label} exit=${r.status ?? "null"}`)
    process.exit(r.status ?? 1)
  }
  return r.status
}

const build = spawnSync("npx", ["tsc", "--build", "packages/backend"], {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
})
if (build.status !== 0) {
  console.error(build.stdout ?? build.stderr)
  process.exit(build.status ?? 1)
}

let bunOk = 0
let nodeOk = 0
for (let i = 1; i <= RUNS; i++) {
  run(`bun-${i}`, "bun", [gateTs])
  bunOk++
}
for (let i = 1; i <= RUNS; i++) {
  run(`node-${i}`, "node", [gateJs])
  nodeOk++
}

console.log(`@@@DUAL_RUNTIME_GATE_OK bun=${bunOk}/${RUNS} node=${nodeOk}/${RUNS}`)
