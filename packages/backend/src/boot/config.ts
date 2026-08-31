/**
 * boot/config.ts — typed config load for server boot (C1).
 *
 * loadAppConfig is the single config entry for server.ts / main.ts.
 * wireRecorderDir resolves the wire-recording directory from config, not env truthiness.
 */

import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { loadConfig } from "../config/load-config.js"
import { ensureStateSubdir } from "../paths.js"

/** Load and return resolved DriveCodingConfig. Exits on fatal errors (shim path). */
export function loadAppConfig(env?: NodeJS.ProcessEnv): DriveCodingConfig {
  const result = loadConfig({ argv: {}, env: env ?? process.env })
  for (const w of result.warnings) {
    console.warn(w)
  }
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      console.error(e)
    }
    process.exit(1)
  }
  return result.config
}

/** Returns wire-recordings dir when wireRecord is true; null otherwise (no truthiness on env strings). */
export function wireRecorderDir(config: Pick<DriveCodingConfig, "wireRecord">): string | null {
  if (config.wireRecord === true) {
    return ensureStateSubdir("wire-recordings")
  }
  return null
}
