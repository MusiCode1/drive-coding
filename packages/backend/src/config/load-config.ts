/**
 * load-config.ts — IO shell for config loading.
 *
 * Reads config from (in order of increasing priority):
 *   1. Default config file: <stateDir>/config.jsonc  (or --config / --config-json flag)
 *   2. process.env (including values injected by --env-file)
 *   3. CLI flags (argv)
 *
 * Returns the resolved config + an envPatch map (string-ified values to write to
 * process.env) + any warnings collected along the way.
 *
 * Pure resolution is delegated to core/config/resolve. This module owns all IO.
 */

import * as fs from "node:fs"
import { join } from "node:path"
import { parseEnvFile } from "@drive-coding/core/config/env-file"
import { resolveConfig } from "@drive-coding/core/config/resolve"
import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { getStateDir } from "../paths.js"

export type RawArgs = Record<string, string | boolean | undefined>

export type LoadConfigResult = {
  config: DriveCodingConfig
  /** String-ified values to write to process.env. The bin writes these after calling loadConfig. */
  envPatch: Record<string, string>
  warnings: string[]
}

// ---------------------------------------------------------------------------
// JSONC comment stripper (same logic as cli-config-file.ts)
// ---------------------------------------------------------------------------
function stripJsoncComments(text: string): string {
  let result = text.replace(/\/\*[\s\S]*?\*\//g, "")
  result = result
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n")
  return result
}

// ---------------------------------------------------------------------------
// Layer builders
// ---------------------------------------------------------------------------

/** Build file layer from --config / --config-json / default path. */
function buildFileLayer(
  argv: RawArgs,
  warnings: string[],
): Partial<DriveCodingConfig> {
  // --config-json takes precedence over --config (inline JSON wins over file path).
  const configJsonArg = argv["config-json"] as string | undefined
  if (configJsonArg !== undefined) {
    try {
      const parsed: unknown = JSON.parse(configJsonArg)
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Partial<DriveCodingConfig>
      }
      warnings.push("[load-config] --config-json must be a JSON object — ignoring")
    } catch {
      warnings.push("[load-config] --config-json: invalid JSON — ignoring")
    }
    return {}
  }

  // --config <path> or default.
  const configArg = argv["config"] as string | undefined
  const configPath = configArg ?? join(getStateDir(), "config.jsonc")

  if (!fs.existsSync(configPath)) {
    // Default file absent — normal, no warning.
    return {}
  }

  let raw: string
  try {
    raw = fs.readFileSync(configPath, "utf8")
  } catch (e) {
    warnings.push(`[load-config] failed to read config file ${configPath}: ${String(e)}`)
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsoncComments(raw))
  } catch {
    warnings.push(`[load-config] config file ${configPath} is not valid JSON/JSONC — ignoring`)
    return {}
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push(`[load-config] config file ${configPath} must be a JSON object — ignoring`)
    return {}
  }

  return parsed as Partial<DriveCodingConfig>
}

/** Build env layer from process.env. */
function buildEnvLayer(env: NodeJS.ProcessEnv): Partial<DriveCodingConfig> {
  const layer: Partial<DriveCodingConfig> = {}

  if (env.PORT) {
    const p = Number(env.PORT)
    if (!Number.isNaN(p)) layer.port = p
  }
  if (env.DRIVE_CODING_HOST) layer.host = env.DRIVE_CODING_HOST
  if (env.CORS_ORIGINS) {
    layer.corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  }
  if (env.FE_STATIC_DIR) layer.feStaticDir = env.FE_STATIC_DIR
  if (env.OPENCODE_BIN) layer.opencodeBin = env.OPENCODE_BIN
  if (env.WIRE_RECORD) layer.wireRecord = env.WIRE_RECORD === "1"
  if (env.FS_BROWSE_ALLOWED_BASE) layer.fsBrowseBase = env.FS_BROWSE_ALLOWED_BASE

  // Log sub-object — only add if at least one field present.
  const logLevel = env.LOG_LEVEL
  const logNs = env.LOG_NS
  const logFormat = env.LOG_FORMAT
  if (logLevel !== undefined || logNs !== undefined || logFormat !== undefined) {
    const logObj: NonNullable<DriveCodingConfig["log"]> = {}
    if (logLevel) logObj.level = logLevel
    if (logNs) logObj.ns = logNs
    if (logFormat === "pretty" || logFormat === "json" || logFormat === "both") {
      logObj.format = logFormat
    }
    layer.log = logObj
  }

  // Voice sub-object.
  const elevenLabsKey = env.ELEVENLABS_API_KEY
  const geminiKey = env.GEMINI_API_KEY
  if (elevenLabsKey !== undefined || geminiKey !== undefined) {
    const voiceObj: NonNullable<DriveCodingConfig["voice"]> = {}
    if (elevenLabsKey) voiceObj.elevenLabsKey = elevenLabsKey
    if (geminiKey) voiceObj.geminiKey = geminiKey
    layer.voice = voiceObj
  }

  // CLI_SPECS_JSON.
  if (env.CLI_SPECS_JSON) {
    try {
      const parsed: unknown = JSON.parse(env.CLI_SPECS_JSON)
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        layer.cliSpecs = parsed as Record<string, unknown>
      }
    } catch {
      // Broken JSON in env — ignore silently (caller already wrote it).
    }
  }

  return layer
}

/** Build flag layer from parsed CLI argv. */
function buildFlagLayer(argv: RawArgs, warnings: string[]): Partial<DriveCodingConfig> {
  const layer: Partial<DriveCodingConfig> = {}

  // Secret flags — warn about process-list visibility.
  const secretFlags = ["elevenlabs-key", "gemini-key"] as const
  for (const flag of secretFlags) {
    if (argv[flag] !== undefined) {
      warnings.push(
        `[load-config] --${flag} is visible in the process list. ` +
          "Prefer setting the secret via --env-file or environment variable.",
      )
    }
  }

  if (argv["port"] !== undefined) {
    const p = Number(argv["port"])
    if (!Number.isNaN(p)) layer.port = p
  }
  if (argv["host"]) layer.host = argv["host"] as string
  if (argv["cors-origins"]) {
    layer.corsOrigins = (argv["cors-origins"] as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (argv["fe-static-dir"]) layer.feStaticDir = argv["fe-static-dir"] as string
  if (argv["opencode-bin"]) layer.opencodeBin = argv["opencode-bin"] as string
  if (argv["log-level"]) {
    layer.log = { level: argv["log-level"] as string }
  }

  // Voice keys from flags.
  const elevenLabsKey = argv["elevenlabs-key"] as string | undefined
  const geminiKey = argv["gemini-key"] as string | undefined
  if (elevenLabsKey !== undefined || geminiKey !== undefined) {
    const voiceObj: NonNullable<DriveCodingConfig["voice"]> = {}
    if (elevenLabsKey) voiceObj.elevenLabsKey = elevenLabsKey
    if (geminiKey) voiceObj.geminiKey = geminiKey
    layer.voice = voiceObj
  }

  return layer
}

// ---------------------------------------------------------------------------
// envPatch builder
// ---------------------------------------------------------------------------
function buildEnvPatch(config: DriveCodingConfig): Record<string, string> {
  const patch: Record<string, string> = {}

  if (config.port !== undefined) patch["PORT"] = String(config.port)
  if (config.host !== undefined) patch["DRIVE_CODING_HOST"] = config.host
  if (config.corsOrigins !== undefined) patch["CORS_ORIGINS"] = config.corsOrigins.join(",")
  if (config.feStaticDir !== undefined) patch["FE_STATIC_DIR"] = config.feStaticDir
  if (config.opencodeBin !== undefined) patch["OPENCODE_BIN"] = config.opencodeBin
  if (config.wireRecord !== undefined) patch["WIRE_RECORD"] = config.wireRecord ? "1" : "0"
  if (config.fsBrowseBase !== undefined) patch["FS_BROWSE_ALLOWED_BASE"] = config.fsBrowseBase

  if (config.log !== undefined) {
    if (config.log.level !== undefined) patch["LOG_LEVEL"] = config.log.level
    if (config.log.ns !== undefined) patch["LOG_NS"] = config.log.ns
    if (config.log.format !== undefined) patch["LOG_FORMAT"] = config.log.format
  }

  if (config.voice !== undefined) {
    if (config.voice.elevenLabsKey !== undefined) {
      patch["ELEVENLABS_API_KEY"] = config.voice.elevenLabsKey
    }
    if (config.voice.geminiKey !== undefined) {
      patch["GEMINI_API_KEY"] = config.voice.geminiKey
    }
  }

  if (config.cliSpecs !== undefined) {
    patch["CLI_SPECS_JSON"] = JSON.stringify(config.cliSpecs)
  }

  if (config.https !== undefined) {
    patch["DRIVE_CODING_HTTPS"] = JSON.stringify(config.https)
  }

  return patch
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function loadConfig(opts: {
  argv: RawArgs
  env: NodeJS.ProcessEnv
}): LoadConfigResult {
  const warnings: string[] = []

  const fileLayer = buildFileLayer(opts.argv, warnings)
  const envLayer = buildEnvLayer(opts.env)
  const flagLayer = buildFlagLayer(opts.argv, warnings)

  const result = resolveConfig([fileLayer, envLayer, flagLayer])

  if (result.isErr()) {
    // Validation errors — warn and return partial config (empty).
    for (const msg of result.error) {
      warnings.push(`[load-config] validation error: ${msg}`)
    }
    return { config: {} as DriveCodingConfig, envPatch: {}, warnings }
  }

  const config = result.value
  const envPatch = buildEnvPatch(config)

  return { config, envPatch, warnings }
}

// Re-export parseEnvFile for bin use (avoids double import from core).
export { parseEnvFile }
