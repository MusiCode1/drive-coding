/**
 * session-history-schema.ts — the entry point callers use: bring a database up to date.
 *
 * The shapes live in session-history-schema-ddl.ts; the stepping lives in
 * schema-migrations.ts. This file keeps the one-argument signature the call sites
 * (sqlite-bootstrap, sqlite-dual-runtime-gate) already use.
 */

import {
  type RunSchemaMigrationsOpts,
  runSchemaMigrations,
  SESSION_HISTORY_USER_VERSION,
} from "./schema-migrations.js"
import {
  listSessionTableColumns,
  SESSION_HISTORY_DDL,
  SESSION_TABLE_COLUMNS,
} from "./session-history-schema-ddl.js"
import type { SqliteDb } from "./sqlite-adapter.js"

export {
  listSessionTableColumns,
  SESSION_HISTORY_DDL,
  SESSION_HISTORY_USER_VERSION,
  SESSION_TABLE_COLUMNS,
}

/**
 * Applies every pending schema step. Idempotent: a database already at the latest
 * version is read and left alone.
 */
export function applySessionHistorySchema(db: SqliteDb, opts?: RunSchemaMigrationsOpts): void {
  runSchemaMigrations(db, opts)
}
