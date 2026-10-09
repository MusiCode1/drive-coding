/**
 * session-history-schema.ts — DDL, pragmas, and schema version for history.sqlite.
 */

import type { SqliteDb } from "./sqlite-adapter.js"

export const SESSION_HISTORY_USER_VERSION = 1

/** All session columns created in S1 (metadata columns stay NULL until part B). */
export const SESSION_TABLE_COLUMNS = [
  "cliKind",
  "acpSessionId",
  "agentId",
  "cwd",
  "openedByEmail",
  "parentAgentId",
  "lastTitle",
  "titleManual",
  "lastModelId",
  "userNotes",
  "sessionFields",
  "roleLabel",
  "createdAt",
  "firstSeenAt",
  "lastSeenAt",
  "lastAttachedAt",
  "turns",
] as const

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  cliKind TEXT NOT NULL,
  acpSessionId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  cwd TEXT NOT NULL,
  openedByEmail TEXT,
  parentAgentId TEXT,
  lastTitle TEXT,
  titleManual INTEGER CHECK (titleManual IS NULL OR titleManual IN (0, 1)),
  lastModelId TEXT,
  userNotes TEXT,
  sessionFields TEXT,
  roleLabel TEXT,
  createdAt INTEGER,
  firstSeenAt INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL,
  lastAttachedAt INTEGER NOT NULL,
  turns INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cliKind, acpSessionId)
);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd_attached ON sessions (cwd, lastAttachedAt DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions (lastSeenAt DESC);

CREATE TABLE IF NOT EXISTS session_usage (
  cliKind TEXT NOT NULL,
  acpSessionId TEXT NOT NULL,
  lastUsed INTEGER NOT NULL,
  size INTEGER NOT NULL,
  cyclesTruncated INTEGER NOT NULL CHECK (cyclesTruncated IN (0, 1)),
  costAmount REAL,
  costCurrency TEXT,
  PRIMARY KEY (cliKind, acpSessionId),
  FOREIGN KEY (cliKind, acpSessionId) REFERENCES sessions (cliKind, acpSessionId)
);

CREATE TABLE IF NOT EXISTS usage_cycles (
  cliKind TEXT NOT NULL,
  acpSessionId TEXT NOT NULL,
  cycleIndex INTEGER NOT NULL,
  startedAt INTEGER NOT NULL,
  peakUsed INTEGER NOT NULL,
  closedAt INTEGER,
  PRIMARY KEY (cliKind, acpSessionId, cycleIndex),
  FOREIGN KEY (cliKind, acpSessionId) REFERENCES session_usage (cliKind, acpSessionId)
);

CREATE TABLE IF NOT EXISTS hidden_folders (
  cwd TEXT PRIMARY KEY,
  hiddenAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_folders (
  cwd TEXT PRIMARY KEY,
  cliKind TEXT NOT NULL,
  lastSeenAt INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history_migrations (
  migrationId TEXT PRIMARY KEY,
  completedAt INTEGER NOT NULL
);
`

export function applySessionHistorySchema(db: SqliteDb): void {
  const row = db.prepare("PRAGMA user_version").get<{ user_version: number }>()
  const current = row?.user_version ?? 0
  if (current >= SESSION_HISTORY_USER_VERSION) return
  if (current !== 0) {
    throw new Error(`Unsupported session history schema user_version=${current}`)
  }
  db.exec(DDL)
  db.exec(`PRAGMA user_version = ${SESSION_HISTORY_USER_VERSION}`)
}

export function listSessionTableColumns(db: SqliteDb): string[] {
  return db
    .prepare("PRAGMA table_info(sessions)")
    .all<{ name: string }>()
    .map((r) => r.name)
}
