/**
 * boot/history-import.ts — one-shot legacy JSON import at server boot (main.ts only).
 */

import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { createLogger } from "@drive-coding/core/log"
import { emptyLegacyImportStats } from "../history/legacy-record-schema.js"
import {
  discoverLegacyJsonSources,
  type LegacySources,
} from "../history/session-history-migration.js"
import {
  isHistoryDbFileOverridden,
  resolveHistoryDbFile,
} from "../history/session-history-store.js"
import { BOOT_DB_BUDGET_MS, runLegacyImportWithRetry } from "./sqlite-bootstrap.js"

const log = createLogger("backend.history.import")

export type BootLegacyImportOpts = {
  /** Absolute deadline for open+schema+import (shared budget). */
  deadlineAt?: number
  /** Explicit fixture paths — bypasses home discovery (parallel import / tests). */
  legacySources?: LegacySources
}

export async function runBootLegacyImport(
  config: DriveCodingConfig,
  env: NodeJS.ProcessEnv,
  opts?: BootLegacyImportOpts,
): Promise<void> {
  const dbFile = resolveHistoryDbFile(config, env)
  const deadlineAt = opts?.deadlineAt ?? Date.now() + BOOT_DB_BUDGET_MS

  let legacySources: LegacySources
  if (opts?.legacySources !== undefined) {
    legacySources = opts.legacySources
  } else if (isHistoryDbFileOverridden(config, env)) {
    return
  } else {
    legacySources = discoverLegacyJsonSources()
  }

  if (legacySources.usageJsonPath === undefined && legacySources.projectsJsonPath === undefined) {
    return
  }

  const stats = emptyLegacyImportStats()
  const result = await runLegacyImportWithRetry(dbFile, legacySources, deadlineAt, stats)
  // 🔴 The counters are the point: a skipped record is data the user had and no longer
  // has. Without them the loss is indistinguishable from "there was nothing to import".
  log.info({ result, dbFile, ...stats }, "legacy session history import finished")
  if (stats.usageSkipped > 0 || stats.projectsSkipped > 0) {
    log.warn(
      {
        usageSkipped: stats.usageSkipped,
        projectsSkipped: stats.projectsSkipped,
        reasons: stats.reasons,
      },
      "legacy records skipped — malformed source data",
    )
  }
}
