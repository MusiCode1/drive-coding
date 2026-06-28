#!/usr/bin/env node
// scripts/dc-build-fe.mjs
// Builds the FE atomically into packages/frontend/build/.
// Usage:
//   node scripts/dc-build-fe.mjs             — always build (full refresh)
//   node scripts/dc-build-fe.mjs --if-missing — skip if build/index.html already exists
//
// Flow:
//   1. vite build → packages/frontend/.build-staging/  (via FE_BUILD_OUT env)
//   2. verify staging/index.html exists (throw if vite silently failed)
//   3. atomic swap: rm .build-old; mv build→.build-old; mv .build-staging→build; rm .build-old
//
// The atomic swap keeps the live build/ intact while the (slow) vite build runs
// to staging. The two renames are metadata-only — sub-millisecond window.
import { existsSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ifMissing = process.argv.includes("--if-missing")

const feRoot = path.join(repoRoot, "packages/frontend")
const buildDir = path.join(feRoot, "build")
const stagingDir = path.join(feRoot, ".build-staging")
const oldDir = path.join(feRoot, ".build-old")

// --if-missing: skip if build/index.html already exists
if (ifMissing && existsSync(path.join(buildDir, "index.html"))) {
  console.log("[dc-build-fe] build exists — skipping (--if-missing)")
  process.exit(0)
}

console.log("[dc-build-fe] starting FE build...")

// 1) Build to staging dir (FE_BUILD_OUT is relative to packages/frontend — adapter-static resolves from there)
execFileSync("pnpm", ["--filter", "@drive-coding/frontend-v2", "build"], {
  stdio: "inherit",
  cwd: repoRoot,
  env: { ...process.env, FE_BUILD_OUT: ".build-staging" },
})

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
