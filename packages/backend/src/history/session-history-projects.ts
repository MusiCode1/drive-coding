/**
 * session-history-projects.ts — folder ranking, legacy rows, and hide filtering.
 */

import type { ProjectRow } from "./session-history-store.js"
import type { SqliteDb } from "./sqlite-adapter.js"

export type ListProjectsOpts = { includeHidden?: boolean }

function latestSessionForCwd(
  db: SqliteDb,
  cwd: string,
): { cliKind: string; acpSessionId: string; lastAttachedAt: number } | undefined {
  return db
    .prepare(
      `SELECT cliKind, acpSessionId, lastAttachedAt FROM sessions
       WHERE cwd = ?
       ORDER BY lastAttachedAt DESC, cliKind ASC, acpSessionId ASC
       LIMIT 1`,
    )
    .get<{ cliKind: string; acpSessionId: string; lastAttachedAt: number }>(cwd)
}

export function listProjectsFromDb(db: SqliteDb, opts?: ListProjectsOpts): ProjectRow[] {
  const includeHidden = opts?.includeHidden === true
  const fromSessions = db
    .prepare(
      `SELECT s.cwd,
        COUNT(*) AS sessionCount,
        MAX(s.lastAttachedAt) AS lastAttached
       FROM sessions s
       WHERE 1=1
       GROUP BY s.cwd`,
    )
    .all<{ cwd: string; sessionCount: number; lastAttached: number }>()

  const sessionCwds = new Set(fromSessions.map((r) => r.cwd))

  let legacySql = `SELECT cwd, cliKind, lastSeenAt FROM legacy_folders
       WHERE cwd NOT IN (SELECT cwd FROM sessions)`
  if (!includeHidden) {
    legacySql += " AND cwd NOT IN (SELECT cwd FROM hidden_folders)"
  }
  const legacyRows = db.prepare(legacySql).all<{
    cwd: string
    cliKind: string
    lastSeenAt: number
  }>()

  const rows: Array<{
    cwd: string
    sessionCount: number
    lastAttached: number
    kind: string
    lastSessionId?: string
  }> = []

  for (const r of fromSessions) {
    if (!includeHidden) {
      const hid = db.prepare("SELECT 1 FROM hidden_folders WHERE cwd = ?").get(r.cwd)
      if (hid !== undefined) continue
    }
    const latest = latestSessionForCwd(db, r.cwd)
    rows.push({
      cwd: r.cwd,
      sessionCount: r.sessionCount,
      lastAttached: latest?.lastAttachedAt ?? r.lastAttached,
      kind: latest?.cliKind ?? "",
      lastSessionId: latest?.acpSessionId,
    })
  }

  for (const leg of legacyRows) {
    if (sessionCwds.has(leg.cwd)) continue
    rows.push({
      cwd: leg.cwd,
      sessionCount: 0,
      lastAttached: leg.lastSeenAt,
      kind: leg.cliKind,
    })
  }

  rows.sort((a, b) => {
    if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
    if (b.lastAttached !== a.lastAttached) return b.lastAttached - a.lastAttached
    return a.cwd.localeCompare(b.cwd)
  })

  return rows.map((r) => ({
    cwd: r.cwd,
    kind: r.kind,
    lastSeen: new Date(r.lastAttached).toISOString(),
    lastSessionId: r.lastSessionId,
    sessionCount: r.sessionCount,
  }))
}

/** Test/admin: register a legacy-only folder row (import uses migration module in Commit 3). */
export function insertLegacyFolder(
  db: SqliteDb,
  row: { cwd: string; cliKind: string; lastSeenAt: number; payload: string },
): void {
  db.prepare(
    "INSERT OR REPLACE INTO legacy_folders (cwd, cliKind, lastSeenAt, payload) VALUES (?, ?, ?, ?)",
  ).run(row.cwd, row.cliKind, row.lastSeenAt, row.payload)
}
