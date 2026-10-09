/**
 * sqlite-bootstrap.ts — async open/schema/import with shared deadline (fix4 A2).
 * Lives in boot/ to avoid adapter ↔ busy-retry import cycles.
 */

import type { LegacySources } from "../history/session-history-migration.js"
import { runLegacyImport } from "../history/session-history-migration.js"
import { applySessionHistorySchema } from "../history/session-history-schema.js"
import { openSqliteDb, type SqliteDb } from "../history/sqlite-adapter.js"
import { withSqliteBusyRetryUntil } from "../history/sqlite-busy-retry.js"

export const BOOT_DB_BUDGET_MS = 3000
export const WRITE_DB_BUDGET_MS = 1000

export function bootDeadlineFromNow(ms: number = BOOT_DB_BUDGET_MS): number {
  return Date.now() + ms
}

export async function openSqliteDbWithRetry(
  file: string,
  deadlineAt: number,
): Promise<SqliteDb> {
  return withSqliteBusyRetryUntil(() => openSqliteDb(file), deadlineAt)
}

export async function openSqliteDbWithSchema(
  file: string,
  deadlineAt: number,
): Promise<SqliteDb> {
  return withSqliteBusyRetryUntil(() => {
    const db = openSqliteDb(file)
    try {
      applySessionHistorySchema(db)
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
): Promise<ReturnType<typeof runLegacyImport>> {
  let db: SqliteDb | undefined
  try {
    db = await openSqliteDbWithRetry(dbFile, deadlineAt)
    await withSqliteBusyRetryUntil(() => {
      applySessionHistorySchema(db as SqliteDb)
    }, deadlineAt)
    return await withSqliteBusyRetryUntil(
      () => runLegacyImport({ db: db as SqliteDb, legacySources }),
      deadlineAt,
    )
  } finally {
    db?.close()
  }
}
