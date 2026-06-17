#!/usr/bin/env bun
// packages/backend/src/bin/drive-coding.ts
import { execFileSync } from "node:child_process"
import path from "node:path"

// FE build sits at packages/frontend/build.
// This file is at packages/backend/src/bin → go up three levels (bin→src→backend→packages),
// then into frontend/build.
const feBuildDir = path.resolve(import.meta.dirname, "../../../frontend/build")

// Do not override values the user set explicitly (env > default).
process.env.FE_STATIC_DIR ??= feBuildDir
process.env.PORT ??= "4000"

const port = process.env.PORT

// Preflight: check that the default AI agent (opencode) is reachable.
// The user may override via OPENCODE_BIN. If missing — warn but do not block
// (they might use claude/codex which are typically invoked via npx).
const agentBin = process.env.OPENCODE_BIN ?? "opencode"
try {
  // On POSIX: `which <bin>`; on Windows: `where <bin>` — both exit 0 if found.
  const isWindows = process.platform === "win32"
  execFileSync(isWindows ? "where" : "which", [agentBin], { stdio: "ignore" })
} catch {
  console.warn(
    `[drive-coding] Warning: agent binary "${agentBin}" not found in PATH.` +
      " Set OPENCODE_BIN to point to your agent, or install opencode: https://opencode.ai",
  )
}

console.log(`[drive-coding] Starting — http://localhost:${port}`)

// This import starts the server (side-effect, rises on-import).
// Must come AFTER env is set (server.ts reads env on-import).
await import("../server.js")
