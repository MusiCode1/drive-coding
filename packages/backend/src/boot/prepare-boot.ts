/**
 * prepare-boot.ts — process guards, config load, and legacy history import.
 */

import { loadAppConfig } from "./config.js"
import { runBootLegacyImport } from "./history-import.js"
import { registerProcessGuards } from "./process-guards.js"
import { BOOT_DB_BUDGET_MS, bootDeadlineFromNow } from "./sqlite-bootstrap.js"

export type PrepareBootResult = {
  config: ReturnType<typeof loadAppConfig>
  bootDeadlineAt: number
}

export async function prepareBoot(): Promise<PrepareBootResult> {
  registerProcessGuards()
  const config = loadAppConfig()
  const bootDeadlineAt = bootDeadlineFromNow(BOOT_DB_BUDGET_MS)
  await runBootLegacyImport(config, process.env, { deadlineAt: bootDeadlineAt })
  return { config, bootDeadlineAt }
}
