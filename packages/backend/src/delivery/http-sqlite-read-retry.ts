/**
 * http-sqlite-read-retry.ts — async BUSY retry at HTTP boundary for sync store reads.
 */

import type { Context } from "hono"
import { READ_DB_BUDGET_MS } from "../boot/sqlite-bootstrap.js"
import {
  classifySqliteHealthError,
  SqliteBusyError,
  SqliteIoError,
  SqliteOpenError,
} from "../history/sqlite-adapter.js"
import { withSqliteBusyRetryUntil } from "../history/sqlite-busy-retry.js"

export async function withHistoryReadRetry<T>(fn: () => T): Promise<T> {
  return withSqliteBusyRetryUntil(fn, Date.now() + READ_DB_BUDGET_MS)
}

/** Shared SQLite → HTTP mapping for read and write handlers. */
export function sqliteHistoryHttpErrorResponse(c: Context, e: unknown): Response {
  if (e instanceof SqliteBusyError) {
    return c.json({ error: "database_locked", code: "SQLITE_BUSY" }, 503)
  }
  if (e instanceof SqliteIoError) {
    return c.json({ error: "history_write_failed", code: "HISTORY_WRITE" }, 500)
  }
  if (e instanceof SqliteOpenError) {
    return c.json({ error: "database_unavailable", code: "SQLITE_OPEN" }, 500)
  }
  const classified = classifySqliteHealthError(e, "history")
  if (classified instanceof SqliteBusyError) {
    return c.json({ error: "database_locked", code: "SQLITE_BUSY" }, 503)
  }
  if (classified instanceof SqliteIoError) {
    return c.json({ error: "history_write_failed", code: "HISTORY_WRITE" }, 500)
  }
  return c.json({ error: "database_unavailable", code: "SQLITE_OPEN" }, 500)
}
