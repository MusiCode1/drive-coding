/**
 * boot/history-import.ts — one-shot legacy JSON import at server boot (main.ts only).
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import type { DriveCodingConfig } from "@drive-coding/core/config/schema"
import { createLogger } from "@drive-coding/core/log"
import { runLegacyImport } from "../history/session-history-migration.js"
import { applySessionHistorySchema } from "../history/session-history-schema.js"
import { resolveHistoryDbFile } from "../history/session-history-store.js"
import { openSqliteDb } from "../history/sqlite-adapter.js"
import { ensureStateSubdir } from "../paths.js"

const log = createLogger("backend.history.import")

export function runBootLegacyImport(config: DriveCodingConfig, env: NodeJS.ProcessEnv): void {
  const usagePath = join(ensureStateSubdir("token-usage"), "sessions.json")
  const projectsPath = join(ensureStateSubdir("cache"), "projects-registry.json")
  const hasUsage = existsSync(usagePath)
  const hasProjects = existsSync(projectsPath)
  if (!hasUsage && !hasProjects) return

  const dbFile = resolveHistoryDbFile(config, env)
  const db = openSqliteDb(dbFile)
  applySessionHistorySchema(db)
  try {
    const result = runLegacyImport({
      db,
      legacySources: {
        usageJsonPath: hasUsage ? usagePath : undefined,
        projectsJsonPath: hasProjects ? projectsPath : undefined,
      },
    })
    log.info({ result, dbFile }, "legacy session history import finished")
  } finally {
    db.close()
  }
}
