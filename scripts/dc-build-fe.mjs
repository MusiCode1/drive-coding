#!/usr/bin/env node
// scripts/dc-build-fe.mjs
// Builds the FE atomically into packages/frontend/build/.
// Usage:
//   node scripts/dc-build-fe.mjs             — always build (full refresh)
//   node scripts/dc-build-fe.mjs --if-missing — skip if build/index.html already exists
//   node scripts/dc-build-fe.mjs --if-stale  — skip if build exists AND version matches HEAD
//
// Flow:
//   1. vite build → packages/frontend/.build-staging/  (via FE_BUILD_OUT env)
//   2. verify staging/index.html exists (throw if vite silently failed)
//   3. atomic swap: rm .build-old; mv build→.build-old; mv .build-staging→build; rm .build-old
//
// The atomic swap keeps the live build/ intact while the (slow) vite build runs
// to staging. The two renames are metadata-only — sub-millisecond window.
//
// NOTE: computeExpectedVersion() mirrors svelte.config.js appVersion formula exactly.
// If the formula changes there, update it here too.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runFilterArgs, runPm } from "./pm.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ifMissing = process.argv.includes("--if-missing")
const ifStale = process.argv.includes("--if-stale")

const feRoot = path.join(repoRoot, "packages/frontend")
const buildDir = path.join(feRoot, "build")
const stagingDir = path.join(feRoot, ".build-staging")
const oldDir = path.join(feRoot, ".build-old")

/** Mirrors svelte.config.js exactly: v${rootPkg.version} (${short-sha|nogit}). */
function computeExpectedVersion() {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  let sha = "nogit"
  try {
    sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).toString().trim()
  } catch {}
  return `v${pkg.version} (${sha})`
}

/** Returns the version embedded in the active build, or null if missing/invalid. */
function readBuiltVersion() {
  const vj = path.join(buildDir, "_app", "version.json")
  if (!existsSync(vj)) return null
  try {
    return JSON.parse(readFileSync(vj, "utf8")).version ?? null
  } catch {
    return null
  }
}

const indexExists = existsSync(path.join(buildDir, "index.html"))

// --if-missing: skip if build/index.html already exists (legacy, no version check)
if (ifMissing && indexExists) {
  console.log("[dc-build-fe] build exists — skipping (--if-missing)")
  process.exit(0)
}

// --if-stale: skip only if build exists AND version matches HEAD
if (ifStale && indexExists) {
  const expected = computeExpectedVersion()
  const built = readBuiltVersion()
  if (built === expected) {
    console.log(`[dc-build-fe] build up-to-date (${built}) — skipping (--if-stale)`)
    process.exit(0)
  }
  console.log(`[dc-build-fe] build stale (built=${built}, expected=${expected}) — rebuilding`)
}
// (falls through to build: default / missing-but-no-skip / stale)

console.log("[dc-build-fe] starting FE build...")

// 1) Build to staging dir (FE_BUILD_OUT is relative to packages/frontend — adapter-static resolves from there)
//    PM-agnostic: bun `run --filter … build` on the server, pnpm `--filter … build` on dev.
const [feCmd, feArgs] = runFilterArgs("@drive-coding/frontend", "build")
const feCode = runPm(feCmd, feArgs, {
  cwd: repoRoot,
  env: { ...process.env, FE_BUILD_OUT: ".build-staging" },
})
if (feCode !== 0) throw new Error(`[dc-build-fe] FE build failed (exit ${feCode})`)

// 2) Verify staging produced index.html (guard against silent vite failure)
const stagingIndex = path.join(stagingDir, "index.html")
if (!existsSync(stagingIndex)) {
  throw new Error("[dc-build-fe] FATAL: vite build succeeded but staging/index.html is missing")
}

// 3) Atomic swap
//    rm .build-old (leftover from previous interrupted build, if any)
rmSync(oldDir, { recursive: true, force: true })
//    mv build → .build-old  (metadata-only rename — fast; live build/ stays intact up to this line)
if (existsSync(buildDir)) {
  renameSync(buildDir, oldDir)
}
//    mv .build-staging → build  (also metadata-only — the new build is now live)
renameSync(stagingDir, buildDir)
//    rm .build-old (cleanup)
rmSync(oldDir, { recursive: true, force: true })

console.log("[dc-build-fe] done — packages/frontend/build/ updated")
