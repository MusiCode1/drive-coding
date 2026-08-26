/**
 * load-config.ts — IO shell for config loading.
 *
 * Reads config from (in order of increasing priority):
 *   1. Default config file: <stateDir>/config.jsonc  (or --config / --config-json flag)
 *   2. process.env (including values injected by --env-file)
 *   3. CLI flags (argv)
 *
 * Secrets are loaded separately (not via resolveConfig):
 *   1. <stateDir>/secrets.json  (or --secrets flag)
 *   2. process.env
 *   3. CLI secret flags
 *
 * Returns the resolved config + secrets + an envPatch map (string-ified values to write to
 * process.env) + any warnings collected along the way.
 *
 * Pure resolution is delegated to core/config/resolve. This module owns all IO.
 */

import * as fs from "node:fs"
import { join } from "node:path"
import { type } from "arktype"
import { parseEnvFile } from "@drive-coding/core/config/env-file"
import { resolveConfig } from "@drive-coding/core/config/resolve"
import {
  DriveCodingSecrets,
  SECRET_SPECS,
  type DriveCodingSecrets as DriveCodingSecretsType,
} from "@drive-coding/core/config/secrets"
import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { getStateDir } from "../paths.js"

export type RawArgs = Record<string, string | boolean | undefined>

export type LoadConfigResult = {
  config: DriveCodingConfig
  secrets: DriveCodingSecretsType
  /** String-ified values to write to process.env. The bin writes these after calling loadConfig. */
  envPatch: Record<string, string>
  warnings: string[]
  /** Fatal config-file secret violations — bin must exit before applying envPatch. */
  errors: string[]
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
// Config layer builders
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
function buildFlagLayer(argv: RawArgs): Partial<DriveCodingConfig> {
  const layer: Partial<DriveCodingConfig> = {}

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

  return layer
}

// ---------------------------------------------------------------------------
// Secrets layer builders (derived from SECRET_SPECS — no hardcoded env/flag names)
// ---------------------------------------------------------------------------

function buildSecretsFileLayer(
  argv: RawArgs,
  warnings: string[],
): Partial<DriveCodingSecretsType> {
  const secretsArg = argv["secrets"] as string | undefined
  const secretsPath = secretsArg ?? join(getStateDir(), "secrets.json")
  const explicit = secretsArg !== undefined

  if (!fs.existsSync(secretsPath)) {
    if (explicit) {
      warnings.push(`[load-config] --secrets "${secretsPath}" not found — skipping`)
    }
    return {}
  }

  let raw: string
  try {
    raw = fs.readFileSync(secretsPath, "utf8")
  } catch (e) {
    warnings.push(`[load-config] failed to read secrets file ${secretsPath}: ${String(e)}`)
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    warnings.push(`[load-config] secrets file ${secretsPath} is not valid JSON — ignoring`)
    return {}
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push(`[load-config] secrets file ${secretsPath} must be a JSON object — ignoring`)
    return {}
  }

  const validated = DriveCodingSecrets(parsed)
  if (validated instanceof type.errors) {
    warnings.push(`[load-config] secrets file ${secretsPath} has invalid format — ignoring`)
    return {}
  }

  return validated as DriveCodingSecretsType
}

function buildSecretsEnvLayer(env: NodeJS.ProcessEnv): Partial<DriveCodingSecretsType> {
  const layer: Partial<DriveCodingSecretsType> = {}
  for (const spec of SECRET_SPECS) {
    const value = env[spec.env]
    if (value) {
      layer[spec.key] = value
    }
  }
  return layer
}

function buildSecretsFlagLayer(
  argv: RawArgs,
  warnings: string[],
): Partial<DriveCodingSecretsType> {
  const layer: Partial<DriveCodingSecretsType> = {}
  for (const spec of SECRET_SPECS) {
    if (argv[spec.flag] !== undefined) {
      warnings.push(
        `[load-config] --${spec.flag} is visible in the process list. ` +
          "Prefer setting the secret via --env-file or environment variable.",
      )
      const value = argv[spec.flag] as string
      if (value) {
        layer[spec.key] = value
      }
    }
  }
  return layer
}

/** Per-key merge: file < env < flags. */
function mergeSecrets(
  fileLayer: Partial<DriveCodingSecretsType>,
  envLayer: Partial<DriveCodingSecretsType>,
  flagLayer: Partial<DriveCodingSecretsType>,
): DriveCodingSecretsType {
  const secrets: DriveCodingSecretsType = {}
  for (const spec of SECRET_SPECS) {
    const value = flagLayer[spec.key] ?? envLayer[spec.key] ?? fileLayer[spec.key]
    if (value !== undefined) {
      secrets[spec.key] = value
    }
  }
  return secrets
}

// ---------------------------------------------------------------------------
// envPatch builders
// ---------------------------------------------------------------------------
function buildConfigEnvPatch(config: DriveCodingConfig): Record<string, string> {
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

  if (config.cliSpecs !== undefined) {
    patch["CLI_SPECS_JSON"] = JSON.stringify(config.cliSpecs)
  }

  if (config.https !== undefined) {
    patch["DRIVE_CODING_HTTPS"] = JSON.stringify(config.https)
  }

  return patch
}

function buildSecretsEnvPatch(secrets: DriveCodingSecretsType): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const spec of SECRET_SPECS) {
    const value = secrets[spec.key]
    if (value !== undefined) {
      patch[spec.env] = value
    }
  }
  return patch
}

// ---------------------------------------------------------------------------
// Secret-key detection in config file layer (explicit — ArkType strips silently)
// ---------------------------------------------------------------------------

function formatSecretKeyError(
  displayKey: string,
  secretsJsonKey: (typeof SECRET_SPECS)[number]["key"],
  isConfigJson: boolean,
  configPath: string,
  secretsPath: string,
): string {
  const spec = SECRET_SPECS.find((s) => s.key === secretsJsonKey)
  if (!spec) {
    throw new Error(`missing SECRET_SPECS entry for ${secretsJsonKey}`)
  }
  const location = isConfigJson
    ? "is not allowed in --config-json."
    : `is not allowed in the config file\n  ${configPath}.`
  return (
    `[drive-coding] secret key "${displayKey}" ${location} ` +
    `Move it to ${secretsPath} as "${secretsJsonKey}" ` +
    `(or use ${spec.env} / --${spec.flag}). Startup aborted.`
  )
}

function detectSecretKeysInFileLayer(
  fileLayer: Partial<DriveCodingConfig>,
  argv: RawArgs,
): string[] {
  const raw = fileLayer as Record<string, unknown>
  if (Object.keys(raw).length === 0) {
    return []
  }

  const isConfigJson = argv["config-json"] !== undefined
  const configPath = (argv["config"] as string | undefined) ?? join(getStateDir(), "config.jsonc")
  const secretsPath = join(getStateDir(), "secrets.json")
  const errors: string[] = []

  for (const spec of SECRET_SPECS) {
    if (raw[spec.key] !== undefined) {
      errors.push(formatSecretKeyError(spec.key, spec.key, isConfigJson, configPath, secretsPath))
    }
  }

  const voice = raw["voice"]
  if (voice !== undefined && typeof voice === "object" && voice !== null && !Array.isArray(voice)) {
    const voiceObj = voice as Record<string, unknown>
    for (const spec of SECRET_SPECS) {
      if (voiceObj[spec.key] !== undefined) {
        errors.push(
          formatSecretKeyError(`voice.${spec.key}`, spec.key, isConfigJson, configPath, secretsPath),
        )
      }
    }
  }

  return errors
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
  const errors = detectSecretKeysInFileLayer(fileLayer, opts.argv)
  const envLayer = buildEnvLayer(opts.env)
  const flagLayer = buildFlagLayer(opts.argv)

  const secretsFileLayer = buildSecretsFileLayer(opts.argv, warnings)
  const secretsEnvLayer = buildSecretsEnvLayer(opts.env)
  const secretsFlagLayer = buildSecretsFlagLayer(opts.argv, warnings)
  const secrets = mergeSecrets(secretsFileLayer, secretsEnvLayer, secretsFlagLayer)

  const result = resolveConfig([fileLayer, envLayer, flagLayer])

  if (result.isErr()) {
    // Validation errors — warn and return partial config (empty).
    for (const msg of result.error) {
      warnings.push(`[load-config] validation error: ${msg}`)
    }
    return {
      config: {} as DriveCodingConfig,
      secrets,
      envPatch: buildSecretsEnvPatch(secrets),
      warnings,
      errors,
    }
  }

  const config = result.value
  const envPatch = { ...buildConfigEnvPatch(config), ...buildSecretsEnvPatch(secrets) }

  return { config, secrets, envPatch, warnings, errors }
}

// Re-export parseEnvFile for bin use (avoids double import from core).
export { parseEnvFile }
