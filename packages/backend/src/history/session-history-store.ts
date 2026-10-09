/**
 * session-history-store.ts — SQLite-backed session history (attach, usage, folders).
 */

import { join } from "node:path"
import type { TokenUsageRecord } from "../usage/token-usage-store.js"
import { applySessionHistorySchema } from "./session-history-schema.js"
import {
  buildUsageRecord,
  ingestUsageInTransaction,
  loadCycles,
  type SessionKey,
} from "./session-history-usage-persist.js"
import { openSqliteDb, type SqliteDb } from "./sqlite-adapter.js"

export type { SessionKey }

export type ProjectRow = {
  cwd: string
  kind: string
  lastSeen: string
  lastSessionId?: string
  sessionCount: number
}

export type CliSessionRow = {
  cliKind: string
  cwd: string
  firstSeenAt: number
  lastSeenAt: number
  turns: number
  usage?: Omit<
    TokenUsageRecord,
    "acpSessionId" | "agentId" | "cliKind" | "cwd" | "firstSeenAt" | "lastSeenAt" | "turns"
  >
}

export type SessionHistoryStore = {
  recordAttach(p: {
    agentId: string
    cliKind: string
    cwd: string
    acpSessionId: string
    now: number
    openedByEmail?: string
    parentAgentId?: string
  }): void
  ingestUsageUpdate(p: {
    agentId: string
    acpSessionId: string | null
    cliKind: string
    cwd: string
    used: number
    size: number
    cost?: { amount: number; currency?: string }
  }): void
  onTurnEnded(agentId: string, acpSessionId: string | null, now: number): void
  hideFolder(cwd: string): void
  listUsageRecords(opts?: { cwd?: string; limit?: number }): TokenUsageRecord[]
  listProjects(opts?: { includeHidden?: boolean }): ProjectRow[]
  listCliSessionRows(opts?: { cwd?: string }): CliSessionRow[]
  close(): void
}

function sessionKey(cliKind: string, acpSessionId: string): SessionKey {
  return { cliKind, acpSessionId }
}

function listUsageFromDb(
  db: SqliteDb,
  opts?: { cwd?: string; limit?: number },
): TokenUsageRecord[] {
  let sql = `SELECT s.cliKind, s.acpSessionId FROM sessions s
    INNER JOIN session_usage u ON s.cliKind = u.cliKind AND s.acpSessionId = u.acpSessionId`
  const params: (string | number)[] = []
  if (opts?.cwd !== undefined) {
    sql += " WHERE s.cwd = ?"
    params.push(opts.cwd)
  }
  sql += " ORDER BY s.lastSeenAt DESC"
  const keys = db.prepare(sql).all<{ cliKind: string; acpSessionId: string }>(...params)
  let list = keys
    .map((k) =>
      buildUsageRecord(db, sessionKey(k.cliKind, k.acpSessionId), {
        agentId: "",
        cliKind: k.cliKind,
        cwd: "",
        acpSessionId: k.acpSessionId,
      }),
    )
    .filter((r): r is TokenUsageRecord => r !== undefined)
  if (opts?.limit !== undefined && opts.limit > 0) {
    list = list.slice(0, opts.limit)
  }
  return list.map((r) => ({
    ...r,
    cycles: r.cycles.map((c) => ({ ...c })),
  }))
}

export function createSessionHistoryStore(dbFile: string): SessionHistoryStore {
  const db = openSqliteDb(dbFile)
  applySessionHistorySchema(db)

  return {
    recordAttach(p) {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO sessions (
            cliKind, acpSessionId, agentId, cwd,
            openedByEmail, parentAgentId,
            firstSeenAt, lastSeenAt, lastAttachedAt, turns, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
          ON CONFLICT(cliKind, acpSessionId) DO UPDATE SET
            agentId = excluded.agentId,
            cwd = excluded.cwd,
            lastSeenAt = excluded.lastSeenAt,
            lastAttachedAt = excluded.lastAttachedAt,
            firstSeenAt = sessions.firstSeenAt,
            createdAt = COALESCE(sessions.createdAt, excluded.createdAt),
            openedByEmail = CASE
              WHEN sessions.openedByEmail IS NULL AND excluded.openedByEmail IS NOT NULL
              THEN excluded.openedByEmail ELSE sessions.openedByEmail END,
            parentAgentId = CASE
              WHEN sessions.parentAgentId IS NULL AND excluded.parentAgentId IS NOT NULL
              THEN excluded.parentAgentId ELSE sessions.parentAgentId END,
            turns = sessions.turns`,
        ).run(
          p.cliKind,
          p.acpSessionId,
          p.agentId,
          p.cwd,
          p.openedByEmail ?? null,
          p.parentAgentId ?? null,
          p.now,
          p.now,
          p.now,
          p.now,
        )
        db.prepare("DELETE FROM hidden_folders WHERE cwd = ?").run(p.cwd)
      })
    },

    ingestUsageUpdate(p) {
      if (p.acpSessionId === null) return
      const acpSessionId = p.acpSessionId
      db.transaction(() => ingestUsageInTransaction(db, { ...p, acpSessionId }))
    },

    onTurnEnded(agentId, acpSessionId, now) {
      if (acpSessionId === null) return
      db.transaction(() => {
        const row = db
          .prepare("SELECT cliKind FROM sessions WHERE acpSessionId = ? AND agentId = ? LIMIT 1")
          .get<{ cliKind: string }>(acpSessionId, agentId)
        if (row === undefined) return
        db.prepare(
          `UPDATE sessions SET turns = turns + 1, lastSeenAt = ?
           WHERE cliKind = ? AND acpSessionId = ? AND agentId = ?`,
        ).run(now, row.cliKind, acpSessionId, agentId)
      })
    },

    hideFolder(cwd) {
      db.prepare("INSERT OR REPLACE INTO hidden_folders (cwd, hiddenAt) VALUES (?, ?)").run(
        cwd,
        Date.now(),
      )
    },

    listUsageRecords(opts) {
      return listUsageFromDb(db, opts)
    },

    listProjects(opts) {
      const includeHidden = opts?.includeHidden === true
      const hiddenClause = includeHidden ? "" : " AND s.cwd NOT IN (SELECT cwd FROM hidden_folders)"
      const rows = db
        .prepare(
          `SELECT s.cwd,
            COUNT(*) AS sessionCount,
            MAX(s.lastAttachedAt) AS lastAttached
           FROM sessions s
           WHERE 1=1${hiddenClause}
           GROUP BY s.cwd
           ORDER BY sessionCount DESC, lastAttached DESC, s.cwd ASC`,
        )
        .all<{ cwd: string; sessionCount: number; lastAttached: number }>()
      return rows.map((r) => {
        const latest = db
          .prepare(
            `SELECT cliKind, acpSessionId, lastAttachedAt FROM sessions
             WHERE cwd = ?
             ORDER BY lastAttachedAt DESC, cliKind ASC, acpSessionId ASC
             LIMIT 1`,
          )
          .get<{ cliKind: string; acpSessionId: string; lastAttachedAt: number }>(r.cwd)
        return {
          cwd: r.cwd,
          kind: latest?.cliKind ?? "",
          lastSeen: new Date(latest?.lastAttachedAt ?? r.lastAttached).toISOString(),
          lastSessionId: latest?.acpSessionId,
          sessionCount: r.sessionCount,
        }
      })
    },

    listCliSessionRows(opts) {
      let sql = "SELECT cliKind, acpSessionId, cwd, firstSeenAt, lastSeenAt, turns FROM sessions"
      const params: string[] = []
      if (opts?.cwd !== undefined) {
        sql += " WHERE cwd = ?"
        params.push(opts.cwd)
      }
      sql += " ORDER BY lastSeenAt DESC"
      const sessions = db.prepare(sql).all<{
        cliKind: string
        acpSessionId: string
        cwd: string
        firstSeenAt: number
        lastSeenAt: number
        turns: number
      }>(...params)
      return sessions.map((s) => {
        const key = sessionKey(s.cliKind, s.acpSessionId)
        const usageRow = db
          .prepare(
            "SELECT lastUsed, size, cyclesTruncated, costAmount, costCurrency FROM session_usage WHERE cliKind = ? AND acpSessionId = ?",
          )
          .get<{
            lastUsed: number
            size: number
            cyclesTruncated: number
            costAmount: number | null
            costCurrency: string | null
          }>(key.cliKind, key.acpSessionId)
        const row: CliSessionRow = {
          cliKind: s.cliKind,
          cwd: s.cwd,
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
          turns: s.turns,
        }
        if (usageRow !== undefined) {
          const { cycles, cyclesTruncated } = loadCycles(db, key)
          row.usage = {
            lastUsed: usageRow.lastUsed,
            size: usageRow.size,
            cycles,
            cyclesTruncated: cyclesTruncated || usageRow.cyclesTruncated === 1,
          }
          if (usageRow.costAmount !== null) row.usage.costAmount = usageRow.costAmount
          if (usageRow.costCurrency !== null) row.usage.costCurrency = usageRow.costCurrency
        }
        return row
      })
    },

    close() {
      db.close()
    },
  }
}

export function sessionHistoryDbPath(baseDir: string): string {
  return join(baseDir, "history.sqlite")
}
