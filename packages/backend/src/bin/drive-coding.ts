#!/usr/bin/env bun
// packages/backend/src/bin/drive-coding.ts
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { buildVersion, isBinary } from "../binary.js"
import { loadConfig, parseEnvFile } from "../config/load-config.js"

// ---------------------------------------------------------------------------
// Help text (English only — i18n hook blocks Hebrew in code)
// ---------------------------------------------------------------------------
const HELP = `drive-coding — single-command server + web UI for ACP coding agents

Usage:
  drive-coding [options]

Options:
  -p, --port <n>                Port to listen on              (env: PORT, default: 4000)
      --host <addr>             Address to listen on           (env: DRIVE_CODING_HOST, default: 127.0.0.1)
      --opencode-bin <bin>      Agent binary to look for       (env: OPENCODE_BIN, default: opencode)
      --fe-static-dir <dir>     Override served web-UI dir     (env: FE_STATIC_DIR)
      --cors-origins <list>     Comma-separated CORS origins   (env: CORS_ORIGINS)
      --config <path>           Config file (JSONC)            (default: ~/.config/drive-coding/config.jsonc)
      --config-json <json>      Inline JSON config (overrides --config file)
      --env-file <path>         Load secrets from KEY=VALUE file (non-overriding)
      --log-level <level>       Log level (debug|info|warn|error) (env: LOG_LEVEL)
      --elevenlabs-key <key>    ElevenLabs API key             (env: ELEVENLABS_API_KEY)
      --gemini-key <key>        Gemini API key                 (env: GEMINI_API_KEY)
  -h, --help                    Show this help and exit
  -V, --version                 Show version and exit

Precedence: flag > environment variable > config file > default.
Secret flags (--elevenlabs-key, --gemini-key) are visible in the process list —
prefer --env-file or environment variables for secrets.

Examples:
  drive-coding --port 4100
  drive-coding --host 0.0.0.0
  drive-coding --config /etc/drive-coding/config.jsonc
  drive-coding --env-file ~/.secrets/drive-coding.env
  drive-coding --opencode-bin /opt/opencode/bin/opencode`

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
let values: Record<string, string | boolean | undefined>
try {
  ;({ values } = parseArgs({
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      "opencode-bin": { type: "string" },
      "fe-static-dir": { type: "string" },
      "cors-origins": { type: "string" },
      config: { type: "string" },
      "config-json": { type: "string" },
      secrets: { type: "string" },
      "env-file": { type: "string" },
      "log-level": { type: "string" },
      "elevenlabs-key": { type: "string" },
      "gemini-key": { type: "string" },
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

// --version: binary gets version injected at compile time (buildVersion()).
// bundle/dev fall back to reading from package.json on disk.
// release: dist/ → ../package.json (release package)
// dev:     src/bin → ../../package.json (backend)
if (values.version) {
  const compiled = buildVersion()
  const version =
    compiled ??
    (() => {
      const pkgCandidates = [
        path.resolve(import.meta.dirname, "../package.json"),
        path.resolve(import.meta.dirname, "../../package.json"),
      ]
      const pkgPath = pkgCandidates.find(existsSync)
      return pkgPath
        ? ((JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "unknown")
        : "unknown"
    })()
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
if (values.host !== undefined && (values.host as string).trim() === "") {
  console.error("[drive-coding] invalid --host (expected a non-empty address)\n")
  console.error(HELP)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Step 1: --env-file (non-overriding: only keys not already in process.env)
// ---------------------------------------------------------------------------
const envFilePath = values["env-file"] as string | undefined
if (envFilePath !== undefined) {
  if (!existsSync(envFilePath)) {
    console.warn(`[drive-coding] --env-file "${envFilePath}" not found — skipping`)
  } else {
    let envFileText: string
    try {
      envFileText = readFileSync(envFilePath, "utf8")
    } catch (e) {
      console.warn(`[drive-coding] failed to read --env-file "${envFilePath}":`, e)
      envFileText = ""
    }
    const envFileVars = parseEnvFile(envFileText)
    for (const [k, v] of Object.entries(envFileVars)) {
      // Non-overriding: real env wins over env-file.
      if (process.env[k] === undefined) {
        process.env[k] = v
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2: loadConfig — resolve all layers, get envPatch
// ---------------------------------------------------------------------------
const { envPatch, warnings } = loadConfig({ argv: values, env: process.env })

// Print warnings (visible in logs, but not fatal).
for (const w of warnings) {
  console.warn(w)
}

// ---------------------------------------------------------------------------
// Step 3: Write envPatch to process.env (these are the winning values)
// ---------------------------------------------------------------------------
for (const [k, v] of Object.entries(envPatch)) {
  process.env[k] = v
}

// ---------------------------------------------------------------------------
// FE static directory cascade.
// Binary mode with no explicit FE_STATIC_DIR: skip the cascade — FE is served
//   from the embedded manifest (server.ts handles it when isBinary() && !FE_STATIC_DIR).
//   An explicit FE_STATIC_DIR flag/env still overrides the embedded FE (debug/override).
// Dev / npm-bundle mode: resolve from candidate directories as before.
// ??= honours a value already set above (from envPatch or original env).
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
const host = process.env.DRIVE_CODING_HOST ?? "127.0.0.1"

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

console.log(`[drive-coding] Starting — http://${host}:${port}`)

// This import starts the server (side-effect, rises on-import).
// Must come AFTER env is set (server.ts reads env on-import).
await import("../server.js")
