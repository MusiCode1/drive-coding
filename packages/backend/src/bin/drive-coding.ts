#!/usr/bin/env bun
// packages/backend/src/bin/drive-coding.ts
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { isBinary } from "../binary.js"

// ---------------------------------------------------------------------------
// Help text (English only — i18n hook blocks Hebrew in code)
// ---------------------------------------------------------------------------
const HELP = `drive-coding — single-command server + web UI for ACP coding agents

Usage:
  drive-coding [options]

Options:
  -p, --port <n>            Port to listen on            (env: PORT, default: 4000)
      --opencode-bin <bin>  Agent binary to look for     (env: OPENCODE_BIN, default: opencode)
      --fe-static-dir <dir> Override served web-UI dir   (env: FE_STATIC_DIR)
      --cors-origins <list> Comma-separated CORS origins  (env: CORS_ORIGINS)
  -h, --help                Show this help and exit
  -V, --version             Show version and exit

Precedence: flag > environment variable > default.

Examples:
  drive-coding --port 4100
  drive-coding --opencode-bin /opt/opencode/bin/opencode`

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
let values: Record<string, string | boolean | undefined>
try {
  ;({ values } = parseArgs({
    options: {
      port: { type: "string", short: "p" },
      "opencode-bin": { type: "string" },
      "fe-static-dir": { type: "string" },
      "cors-origins": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "V" },
    },
    allowPositionals: false,
  }))
} catch (err) {
  console.error(`[drive-coding] ${(err as Error).message}\n`)
  console.error(HELP)
  process.exit(1)
}

// --help
if (values.help) {
  console.log(HELP)
  process.exit(0)
}

// --version: read from package.json relative to import.meta.dirname
// release: dist/ → ../package.json (release package, 0.1.0)
// dev:     src/bin → ../../package.json (backend, 0.0.0 — acceptable)
if (values.version) {
  const pkgCandidates = [
    path.resolve(import.meta.dirname, "../package.json"),
    path.resolve(import.meta.dirname, "../../package.json"),
  ]
  const pkgPath = pkgCandidates.find(existsSync)
  const version = pkgPath
    ? ((JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "unknown")
    : "unknown"
  console.log(version)
  process.exit(0)
}

// --port validation: parseArgs returns string; non-numeric value would silently
// bind to a random port via Number() → NaN in server.ts:143. Reject early.
if (values.port !== undefined && !/^\d+$/.test(values.port as string)) {
  console.error(`[drive-coding] invalid --port "${values.port as string}" (expected a number)\n`)
  console.error(HELP)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Map flags → env vars (flag wins over existing env; must happen BEFORE ??= below)
// ---------------------------------------------------------------------------
if (values.port) process.env.PORT = values.port as string
if (values["opencode-bin"]) process.env.OPENCODE_BIN = values["opencode-bin"] as string
if (values["fe-static-dir"]) process.env.FE_STATIC_DIR = values["fe-static-dir"] as string
if (values["cors-origins"]) process.env.CORS_ORIGINS = values["cors-origins"] as string

// ---------------------------------------------------------------------------
// FE static directory cascade.
// Binary mode with no explicit FE_STATIC_DIR: skip the cascade — FE is served
//   from the embedded manifest (server.ts handles it when isBinary() && !FE_STATIC_DIR).
//   An explicit FE_STATIC_DIR flag/env still overrides the embedded FE (debug/override).
// Dev / npm-bundle mode: resolve from candidate directories as before.
// ??= honours a flag or env value already set above.
// ---------------------------------------------------------------------------
if (!isBinary()) {
  const feBuildDir =
    [
      path.resolve(import.meta.dirname, "../frontend-dist"), // bundled: dist/ → frontend-dist/
      path.resolve(import.meta.dirname, "../../../frontend/build"), // dev: src/bin → packages/frontend/build
    ].find(existsSync) ?? path.resolve(import.meta.dirname, "../../../frontend/build")

  // Do not override values the user set explicitly (env or flag > default).
  process.env.FE_STATIC_DIR ??= feBuildDir
}
// Binary + explicit FE_STATIC_DIR (flag/env already set above) — no further action needed.
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
