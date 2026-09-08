/**
 * runtime-config.ts — re-reading config.jsonc at runtime, without a restart.
 *
 * The backend resolves its config once at boot (bin/drive-coding.ts) and writes
 * the winning values into `process.env`. This module lets us do that again while
 * the process is live, so that editing `config.jsonc` — or rotating an API key —
 * takes effect without dropping every running agent.
 *
 * Both files feed the same loadConfig: `config.jsonc` for settings and
 * `secrets.json` for API keys, which is why rotating a key needs nothing extra
 * here. A secret written into the plain config file is a fatal violation at
 * boot; on reload we decline instead of exiting.
 *
 * ─── Why the snapshots exist ─────────────────────────────────────────────────
 *
 * 🔴 The bug this module is built around: the bin writes `envPatch` back into
 * `process.env` (Step 3). Layer precedence is `file < env < flag`, so calling
 * `loadConfig({ env: process.env })` a SECOND time rebuilds the env layer out of
 * the values the previous run wrote — and the env layer then beats the freshly
 * edited file. The reload would silently do nothing for every field that appears
 * in both `buildEnvLayer` and `buildEnvPatch`.
 *
 * `ENV_SNAPSHOT` is therefore taken *before* Step 3: the real environment, minus
 * anything derived from the config file. Replaying it on every reload is what
 * makes the file authoritative again.
 *
 * `ARGV_SNAPSHOT` exists because `values` in bin/drive-coding.ts is module-local
 * and never exported, while server.ts is imported from the bin's last line. A
 * reloader without it would lose `--config <path>` and silently fall back to the
 * default `~/.config/drive-coding/config.jsonc`.
 *
 * ─── What can and cannot be reloaded ─────────────────────────────────────────
 *
 * Only HOT_KEYS below. Each entry was verified to be re-read on every use rather
 * than captured once. Everything else — the listening port, the binding, TLS,
 * CORS, FE_STATIC_DIR and friends — is baked into the HTTP server at boot, and a
 * change to it is reported as `requires restart` rather than applied silently.
 *
 * ⚠️ Even for hot keys, a process that is ALREADY RUNNING keeps the environment
 * it was spawned with: spawn-core.ts copies `{ ...process.env }` at spawn time,
 * and there is no channel to update a live process's environment. New children
 * pick up the new value; existing ones do not. The same holds for an existing
 * session host and for an in-process claude bridge.
 */

import { initLogger, parseEnvConfig } from "@drive-coding/core/log"
import { invalidateCapabilitiesCache } from "../delivery/http-tts-capabilities.js"
import { loadConfig, type RawArgs } from "./load-config.js"

// ─── Snapshots, fed by the bin at boot ───────────────────────────────────────

let envSnapshot: NodeJS.ProcessEnv | null = null
let argvSnapshot: RawArgs = {}

/**
 * Record the inputs a later reload has to replay.
 *
 * ⚠️ Call this AFTER the `--env-file` block (those values are a legitimate part
 * of the environment) and BEFORE the envPatch is written to `process.env`.
 * `FE_STATIC_DIR` and `PORT` get their defaults *after* that write, so they are
 * deliberately absent from the snapshot.
 */
export function captureConfigInputs(argv: RawArgs, env: NodeJS.ProcessEnv = process.env): void {
  argvSnapshot = { ...argv }
  envSnapshot = { ...env }
}

/** Test seam: forget the snapshots so a suite can re-capture cleanly. */
export function resetConfigInputs(): void {
  argvSnapshot = {}
  envSnapshot = null
}

// ─── The allowlist ───────────────────────────────────────────────────────────

/**
 * Environment variables that are genuinely re-read on every use, and may
 * therefore be changed while the process is live. Each one was traced to the
 * call site that re-reads it — the comment is the evidence, not a guess.
 */
export const HOT_KEYS = new Set([
  // resolveProviderAuth() is pure and takes `env` as a parameter; http-proxy.ts
  // calls it per request. Nothing captures the key.
  "ELEVENLABS_API_KEY",
  "GEMINI_API_KEY",
  // Read per spawn, in cli-config.ts getCliCommand().
  "OPENCODE_BIN",
  "OPENCODE_ARGS",
  // Read per host, in createSessionHostFromConnection().
  "ELICITATION_TIMEOUT_MS",
  "PERMISSION_TIMEOUT_MS",
  // Hot only because the reloader re-runs initLogger() below.
  "LOG_LEVEL",
  "LOG_NS",
  "LOG_FORMAT",
  "LOG_WIRE",
  // Hot only because every reload path invalidates the cli-specs memo before
  // this runs: loadCliSpecsOverride checks that memo BEFORE it looks at env,
  // so without the reset this value would be ignored entirely.
  "CLI_SPECS_JSON",
])

export type ReloadOutcome = {
  /** Keys whose value changed and was applied to process.env. */
  applied: string[]
  /** Keys whose value changed but that are baked in at boot. */
  requiresRestart: string[]
  /** Warnings from loadConfig (validation errors, secret-flag notices, …). */
  warnings: string[]
}

/**
 * Re-resolve the config and apply what can safely be applied.
 *
 * `loadConfig` itself needs no changes: it holds no module-level state and
 * re-reads the file on every call. The whole trick is *what we feed it*.
 *
 * Returns which keys moved, so the caller can invalidate the right caches and
 * tell the user what needs a restart. Does not throw: a missing or broken
 * config file surfaces as warnings from loadConfig.
 */
export function reloadRuntimeConfig(): ReloadOutcome {
  if (envSnapshot === null) {
    return {
      applied: [],
      requiresRestart: [],
      warnings: ["[runtime-config] no snapshot captured — reload skipped"],
    }
  }

  const { envPatch, warnings, errors } = loadConfig({ argv: argvSnapshot, env: envSnapshot })

  // Same rule as boot, minus the exit: a secret in the plain config file is a
  // violation, and applying a patch derived from it would leak the secret into
  // process.env anyway. Refuse the whole reload — the running config stays.
  if (errors.length > 0) {
    return { applied: [], requiresRestart: [], warnings: [...warnings, ...errors] }
  }

  const applied: string[] = []
  const requiresRestart: string[] = []

  for (const [key, value] of Object.entries(envPatch)) {
    if (process.env[key] === value) continue
    if (HOT_KEYS.has(key)) {
      process.env[key] = value
      applied.push(key)
    } else {
      requiresRestart.push(key)
    }
  }

  return { applied, requiresRestart, warnings }
}

/**
 * Reset the caches that would otherwise mask a freshly applied value.
 *
 * Kept separate from reloadRuntimeConfig so the resolution logic stays testable
 * without dragging in the logger, the provider memo and the TTS probes.
 */
export function applyReloadEffects(outcome: ReloadOutcome): void {
  const applied = new Set(outcome.applied)

  // A stale probe outlives the key swap by up to a minute and makes the reload
  // look broken. This is the one cache that shows through to the user.
  if (applied.has("ELEVENLABS_API_KEY") || applied.has("GEMINI_API_KEY")) {
    invalidateCapabilitiesCache()
  }

  // 🛑 Deliberately does NOT call invalidateCache() here. invalidateCache is
  // what EMITS the config-change event, and this function runs from that
  // event's listener — calling it would recurse forever. Both entry points
  // (the file watcher and POST /api/reload-config) already invalidate before
  // the event fires, so the cli-specs memo is fresh by the time we get here.

  // initLogger rebuilds the config and both pino instances from process.env —
  // the cheapest hot path in the codebase.
  if (
    applied.has("LOG_LEVEL") ||
    applied.has("LOG_NS") ||
    applied.has("LOG_FORMAT") ||
    applied.has("LOG_WIRE")
  ) {
    initLogger(parseEnvConfig())
  }
}
