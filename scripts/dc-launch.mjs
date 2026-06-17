#!/usr/bin/env node
// scripts/dc-launch.mjs
// Launcher: builds the FE if missing, then starts the bin entry.
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, spawn } from "node:child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const feIndexHtml = path.join(repoRoot, "packages/frontend/build/index.html")

if (!existsSync(feIndexHtml)) {
  console.log("[dc-launch] FE build not found — building now...")
  execFileSync(
    "pnpm",
    ["--filter", "@drive-coding/frontend-v2", "build"],
    { stdio: "inherit", cwd: repoRoot },
  )
  console.log("[dc-launch] FE build complete.")
}

const binEntry = path.join(repoRoot, "packages/backend/src/bin/drive-coding.ts")

const child = spawn("bun", [binEntry], {
  stdio: "inherit",
  cwd: repoRoot,
  env: process.env,
})

child.on("exit", (code) => {
  process.exit(code ?? 0)
})
