/**
 * sqlite-bootstrap.ts — async open/schema/import with shared deadline (fix4 A2).
 * Lives in boot/ to avoid adapter ↔ busy-retry import cycles.
 */

import { createLogger } from "@drive-coding/core/log"
import type { LegacyImportStats } from "../history/legacy-record-schema.js"
import type { LegacySources } from "../history/session-history-migration.js"
import { runLegacyImport, vacuumIntoBackup } from "../history/session-history-migration.js"
import { applySessionHistorySchema } from "../history/session-history-schema.js"
import { openSqliteDb, type SqliteDb } from "../history/sqlite-adapter.js"
import { withSqliteBusyRetryUntil } from "../history/sqlite-busy-retry.js"

export const BOOT_DB_BUDGET_MS = 3000
export const WRITE_DB_BUDGET_MS = 1000
export const READ_DB_BUDGET_MS = 600

export function bootDeadlineFromNow(ms: number = BOOT_DB_BUDGET_MS): number {
  return Date.now() + ms
}

const log = createLogger("backend.history.schema")

/**
 * Snapshot before a mutating schema step. `vacuumIntoBackup` has existed since S1 and
 * was never called outside a test — this is what makes a bad migration recoverable
 * instead of merely detectable. Best effort: a failed backup must not stop a boot that
 * would otherwise succeed, so it is logged and the migration proceeds.
 */
function backupBeforeMigration(db: SqliteDb, file: string, fromVersion: number): void {
  const target = `${file}.pre-v${fromVersion}.bak`
  try {
    vacuumIntoBackup(db, target)
    log.info({ target, fromVersion }, "schema migration backup written")
  } catch (e) {
    log.warn({ err: e, target, fromVersion }, "schema migration backup failed")
  }
}

export async function openSqliteDbWithRetry(file: string, deadlineAt: number): Promise<SqliteDb> {
  return withSqliteBusyRetryUntil(() => openSqliteDb(file), deadlineAt)
}

export async function openSqliteDbWithSchema(file: string, deadlineAt: number): Promise<SqliteDb> {
  return withSqliteBusyRetryUntil(() => {
    const db = openSqliteDb(file)
    try {
      applySessionHistorySchema(db, { backup: (from) => backupBeforeMigration(db, file, from) })
      return db
    } catch (e) {
      db.close()
      throw e
    }
  }, deadlineAt)
}

export async function runLegacyImportWithRetry(
  dbFile: string,
  legacySources: LegacySources,
  deadlineAt: number,
  stats?: LegacyImportStats,
): Promise<ReturnType<typeof runLegacyImport>> {
  let db: SqliteDb | undefined
  try {
    db = await openSqliteDbWithRetry(dbFile, deadlineAt)
    await withSqliteBusyRetryUntil(() => {
      applySessionHistorySchema(db as SqliteDb, {
        backup: (from) => backupBeforeMigration(db as SqliteDb, dbFile, from),
      })
    }, deadlineAt)
    return await withSqliteBusyRetryUntil(
      () => runLegacyImport({ db: db as SqliteDb, legacySources, stats }),
      deadlineAt,
    )
  } finally {
    db?.close()
  }
}
