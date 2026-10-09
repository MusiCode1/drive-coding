/**
 * prepare-boot.ts — process guards, config load, and legacy history import.
 */

import { loadAppConfig } from "./config.js"
import { runBootLegacyImport } from "./history-import.js"
import { registerProcessGuards } from "./process-guards.js"

export function prepareBoot(): ReturnType<typeof loadAppConfig> {
  registerProcessGuards()
  const config = loadAppConfig()
  runBootLegacyImport(config, process.env)
  return config
}
