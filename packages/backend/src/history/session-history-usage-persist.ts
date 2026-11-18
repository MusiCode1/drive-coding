/**
 * Load/save usage cycles and session_usage rows (used by session-history-store).
 */

import {
  createInitialTokenUsageRecord,
  type TokenUsageRecord,
  trackUsage,
  type UsageCycle,
} from "../usage/token-usage-store.js"
import type { SqliteDb } from "./sqlite-adapter.js"

export type SessionKey = { cliKind: string; acpSessionId: string }

export function loadCycles(
  db: SqliteDb,
  key: SessionKey,
): { cycles: UsageCycle[]; cyclesTruncated: boolean } {
  const rows = db
    .prepare(
      `SELECT startedAt, peakUsed, closedAt FROM usage_cycles
       WHERE cliKind = ? AND acpSessionId = ?
       ORDER BY cycleIndex ASC`,
    )
    .all<{ startedAt: number; peakUsed: number; closedAt: number | null }>(
      key.cliKind,
      key.acpSessionId,
    )
  const trunc = db
    .prepare("SELECT cyclesTruncated FROM session_usage WHERE cliKind = ? AND acpSessionId = ?")
    .get<{ cyclesTruncated: number }>(key.cliKind, key.acpSessionId)
  return {
    cycles: rows.map((r) => ({
      startedAt: r.startedAt,
      peakUsed: r.peakUsed,
      closedAt: r.closedAt,
    })),
    cyclesTruncated: (trunc?.cyclesTruncated ?? 0) === 1,
  }
}

export function saveCycles(
  db: SqliteDb,
  key: SessionKey,
  cycles: UsageCycle[],
  truncated: boolean,
): void {
  db.prepare("DELETE FROM usage_cycles WHERE cliKind = ? AND acpSessionId = ?").run(
    key.cliKind,
    key.acpSessionId,
  )
  const ins = db.prepare(
    `INSERT INTO usage_cycles (cliKind, acpSessionId, cycleIndex, startedAt, peakUsed, closedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  cycles.forEach((c, i) => {
    ins.run(key.cliKind, key.acpSessionId, i, c.startedAt, c.peakUsed, c.closedAt)
  })
  db.prepare(
    `UPDATE session_usage SET cyclesTruncated = ? WHERE cliKind = ? AND acpSessionId = ?`,
  ).run(truncated ? 1 : 0, key.cliKind, key.acpSessionId)
}

export function upsertSessionForUsage(
  db: SqliteDb,
  p: {
    agentId: string
    cliKind: string
    cwd: string
    acpSessionId: string
    now: number
  },
): void {
  db.prepare(
    `INSERT INTO sessions (
      cliKind, acpSessionId, agentId, cwd, firstSeenAt, lastSeenAt, lastAttachedAt, turns
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(cliKind, acpSessionId) DO UPDATE SET
      agentId = excluded.agentId,
      cwd = excluded.cwd,
      lastSeenAt = excluded.lastSeenAt,
      firstSeenAt = sessions.firstSeenAt,
      lastAttachedAt = sessions.lastAttachedAt,
      turns = sessions.turns`,
  ).run(p.cliKind, p.acpSessionId, p.agentId, p.cwd, p.now, p.now, p.now)
}

export function buildUsageRecord(
  db: SqliteDb,
  key: SessionKey,
  meta: {
    agentId: string
    cliKind: string
    cwd: string
    acpSessionId: string
  },
): TokenUsageRecord | undefined {
  const sess = db
    .prepare(
      `SELECT agentId, cwd, firstSeenAt, lastSeenAt, turns FROM sessions
       WHERE cliKind = ? AND acpSessionId = ?`,
    )
    .get<{
      agentId: string
      cwd: string
      firstSeenAt: number
      lastSeenAt: number
      turns: number
    }>(key.cliKind, key.acpSessionId)
  const usage = db
    .prepare(
      `SELECT lastUsed, size, costAmount, costCurrency FROM session_usage
       WHERE cliKind = ? AND acpSessionId = ?`,
    )
    .get<{
      lastUsed: number
      size: number
      costAmount: number | null
      costCurrency: string | null
    }>(key.cliKind, key.acpSessionId)
  if (sess == null || usage == null) return undefined
  const { cycles, cyclesTruncated } = loadCycles(db, key)
  const rec: TokenUsageRecord = {
    acpSessionId: meta.acpSessionId,
    agentId: sess.agentId,
    cliKind: meta.cliKind,
    cwd: sess.cwd,
    firstSeenAt: sess.firstSeenAt,
    lastSeenAt: sess.lastSeenAt,
    turns: sess.turns,
    lastUsed: usage.lastUsed,
    size: usage.size,
    cycles,
    cyclesTruncated,
  }
  if (usage.costAmount !== null) rec.costAmount = usage.costAmount
  if (usage.costCurrency !== null) rec.costCurrency = usage.costCurrency
  return rec
}

export function ingestUsageInTransaction(
  db: SqliteDb,
  p: {
    agentId: string
    acpSessionId: string
    cliKind: string
    cwd: string
    used: number
    size: number
    cost?: { amount: number; currency?: string }
  },
): void {
  const key: SessionKey = { cliKind: p.cliKind, acpSessionId: p.acpSessionId }
  const now = Date.now()
  upsertSessionForUsage(db, { ...p, now })
  const existing = buildUsageRecord(db, key, {
    agentId: p.agentId,
    cliKind: p.cliKind,
    cwd: p.cwd,
    acpSessionId: p.acpSessionId,
  })
  let rec: TokenUsageRecord
  if (existing == null) {
    rec = createInitialTokenUsageRecord({
      acpSessionId: p.acpSessionId,
      agentId: p.agentId,
      cliKind: p.cliKind,
      cwd: p.cwd,
      now,
      used: p.used,
      size: p.size,
      cost: p.cost,
    })
    db.prepare(
      `INSERT INTO session_usage (
        cliKind, acpSessionId, lastUsed, size, cyclesTruncated, costAmount, costCurrency
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      key.cliKind,
      key.acpSessionId,
      rec.lastUsed,
      rec.size,
      rec.cyclesTruncated ? 1 : 0,
      rec.costAmount ?? null,
      rec.costCurrency ?? null,
    )
    saveCycles(db, key, rec.cycles, rec.cyclesTruncated)
  } else {
    rec = existing
    trackUsage(rec, p, now)
    db.prepare(
      `UPDATE session_usage SET lastUsed = ?, size = ?, costAmount = ?, costCurrency = ?
       WHERE cliKind = ? AND acpSessionId = ?`,
    ).run(
      rec.lastUsed,
      rec.size,
      rec.costAmount ?? null,
      rec.costCurrency ?? null,
      key.cliKind,
      key.acpSessionId,
    )
    saveCycles(db, key, rec.cycles, rec.cyclesTruncated)
  }
  db.prepare(
    "UPDATE sessions SET lastSeenAt = ?, agentId = ?, cwd = ? WHERE cliKind = ? AND acpSessionId = ?",
  ).run(now, p.agentId, p.cwd, key.cliKind, key.acpSessionId)
}
