/**
 * session-history-fail-open.ts — log and swallow history write failures (ACP must continue).
 */

import { createLogger } from "@drive-coding/core/log"
import { isSqliteBusyCause, SqliteBusyError, SqliteOpenError } from "./sqlite-adapter.js"
import { WRITE_DB_BUDGET_MS } from "../boot/sqlite-bootstrap.js"
import { withSqliteBusyRetryUntil } from "./sqlite-busy-retry.js"

const log = createLogger("backend.history.store")

function logHistoryWriteFailure(label: string, e: unknown): void {
  if (e instanceof SqliteBusyError || isSqliteBusyCause(e)) {
    log.warn({ err: e, label }, "history write skipped: database locked")
    return
  }
  if (e instanceof SqliteOpenError) {
    log.warn({ err: e, label }, "history write skipped: database open/health error")
    return
  }
  log.warn({ err: e, label }, "history write skipped: unexpected error")
}

/** Async busy retry (DoD 11); on exhaustion logs and swallows — ACP continues. */
export function runHistoryWriteFailOpen(label: string, fn: () => void): void {
  const deadlineAt = Date.now() + WRITE_DB_BUDGET_MS
  void withSqliteBusyRetryUntil(fn, deadlineAt).catch((e) => {
    logHistoryWriteFailure(label, e)
  })
}
