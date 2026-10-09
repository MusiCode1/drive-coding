/**
 * prepare-boot.ts — process guards, config load, and legacy history import.
 */

import { BOOT_DB_BUDGET_MS, bootDeadlineFromNow } from "./sqlite-bootstrap.js"
import { loadAppConfig } from "./config.js"
import { runBootLegacyImport } from "./history-import.js"
import { registerProcessGuards } from "./process-guards.js"

export async function prepareBoot(): Promise<ReturnType<typeof loadAppConfig>> {
  registerProcessGuards()
  const config = loadAppConfig()
  const deadlineAt = bootDeadlineFromNow(BOOT_DB_BUDGET_MS)
  await runBootLegacyImport(config, process.env, { deadlineAt })
  return config
}
