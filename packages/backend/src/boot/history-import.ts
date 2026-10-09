/**
 * boot/history-import.ts — one-shot legacy JSON import at server boot (main.ts only).
 */

import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { createLogger } from "@drive-coding/core/log"
import { discoverLegacyJsonSources, runLegacyImport } from "../history/session-history-migration.js"
import { applySessionHistorySchema } from "../history/session-history-schema.js"
import { resolveHistoryDbFile } from "../history/session-history-store.js"
import { openSqliteDb } from "../history/sqlite-adapter.js"

const log = createLogger("backend.history.import")

export function runBootLegacyImport(config: DriveCodingConfig, env: NodeJS.ProcessEnv): void {
  const legacySources = discoverLegacyJsonSources()
  if (legacySources.usageJsonPath === undefined && legacySources.projectsJsonPath === undefined) {
    return
  }

  const dbFile = resolveHistoryDbFile(config, env)
  const db = openSqliteDb(dbFile)
  applySessionHistorySchema(db)
  try {
    const result = runLegacyImport({
      db,
      legacySources,
    })
    log.info({ result, dbFile }, "legacy session history import finished")
  } finally {
    db.close()
  }
}
