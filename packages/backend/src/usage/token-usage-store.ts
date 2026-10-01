/**
 * token-usage-store.ts — per-session context usage summary (cycles, cost), persisted.
 *
 * Distinct from usage-store.ts (TTS metering). Writes sessions.json under token-usage/.
 * slice token-usage-persistence
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const MAX_CYCLES = 500

/** One context cycle: from session start or after compaction until the next drop in `used`. */
export type UsageCycle = {
  startedAt: number
  peakUsed: number
  closedAt: number | null
}

export type TokenUsageRecord = {
  acpSessionId: string
  agentId: string
  cliKind: string
  cwd: string
  firstSeenAt: number
  lastSeenAt: number
  turns: number
  lastUsed: number
  size: number
  cycles: UsageCycle[]
  cyclesTruncated: boolean
  costAmount?: number
  costCurrency?: string
}

type SessionsFile = Record<string, TokenUsageRecord>

export type UsageUpdateInput = {
  used: number
  size: number
  cost?: { amount: number; currency?: string }
}

/** Pure update step — see brief §4 algorithm. */
export function trackUsage(
  rec: TokenUsageRecord,
  { used, size, cost }: UsageUpdateInput,
  now: number,
): void {
  const cur = rec.cycles[rec.cycles.length - 1]
  if (cur === undefined) {
    rec.cycles.push({ startedAt: now, peakUsed: used, closedAt: null })
  } else if (used < cur.peakUsed) {
    if (rec.cycles.length < MAX_CYCLES) {
      cur.closedAt = now
      rec.cycles.push({ startedAt: now, peakUsed: used, closedAt: null })
    } else {
      rec.cyclesTruncated = true
    }
  } else {
    cur.peakUsed = used
  }
  rec.lastUsed = used
  rec.size = size
  if (cost !== undefined) {
    rec.costAmount = cost.amount
    if (cost.currency !== undefined) rec.costCurrency = cost.currency
  }
}

export function createInitialTokenUsageRecord(meta: {
  acpSessionId: string
  agentId: string
  cliKind: string
  cwd: string
  now: number
  used: number
  size: number
  cost?: { amount: number; currency?: string }
}): TokenUsageRecord {
  const rec: TokenUsageRecord = {
    acpSessionId: meta.acpSessionId,
    agentId: meta.agentId,
    cliKind: meta.cliKind,
    cwd: meta.cwd,
    firstSeenAt: meta.now,
    lastSeenAt: meta.now,
    turns: 0,
    lastUsed: meta.used,
    size: meta.size,
    cycles: [{ startedAt: meta.now, peakUsed: meta.used, closedAt: null }],
    cyclesTruncated: false,
  }
  if (meta.cost !== undefined) {
    rec.costAmount = meta.cost.amount
    if (meta.cost.currency !== undefined) rec.costCurrency = meta.cost.currency
  }
  return rec
}

export type TokenUsageStore = {
  ingestUsageUpdate(params: {
    agentId: string
    acpSessionId: string | null
    cliKind: string
    cwd: string
    used: number
    size: number
    cost?: { amount: number; currency?: string }
  }): void
  onTurnEnded(agentId: string, acpSessionId: string | null, now: number): void
  listRecords(opts?: { cwd?: string; limit?: number }): TokenUsageRecord[]
  flushOnShutdown(): void
}

export function createTokenUsageStore(baseDir: string): TokenUsageStore {
  const sessionsPath = join(baseDir, "sessions.json")
  try {
    mkdirSync(baseDir, { recursive: true })
  } catch {
    // best-effort
  }

  const sessions: SessionsFile = {}
  try {
    const raw = readFileSync(sessionsPath, "utf8")
    const loaded = JSON.parse(raw) as SessionsFile
    for (const [k, v] of Object.entries(loaded)) {
      if (v && typeof v.acpSessionId === "string") sessions[k] = v
    }
  } catch {
    // missing or corrupt → empty
  }

  /** Last acpSessionId seen per agent (in-memory tracking boundary). */
  const agentSessionKey = new Map<string, string>()

  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const FLUSH_DEBOUNCE_MS = 2_000

  function scheduleFlush() {
    if (flushTimer !== null) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushNow()
    }, FLUSH_DEBOUNCE_MS)
  }

  function flushNow() {
    try {
      writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), "utf8")
    } catch {
      // non-fatal
    }
  }

  const flushOnExit = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushNow()
  }
  process.on("exit", flushOnExit)

  function getOrCreateRecord(params: {
    agentId: string
    acpSessionId: string
    cliKind: string
    cwd: string
    now: number
    used: number
    size: number
    cost?: { amount: number; currency?: string }
  }): TokenUsageRecord {
    let rec = sessions[params.acpSessionId]
    if (rec === undefined) {
      rec = createInitialTokenUsageRecord(params)
      sessions[params.acpSessionId] = rec
    }
    return rec
  }

  return {
    ingestUsageUpdate(params) {
      const { agentId, acpSessionId } = params
      if (acpSessionId === null) return

      const prevKey = agentSessionKey.get(agentId)
      if (prevKey !== undefined && prevKey !== acpSessionId) {
        agentSessionKey.set(agentId, acpSessionId)
      } else if (prevKey === undefined) {
        agentSessionKey.set(agentId, acpSessionId)
      }

      const now = Date.now()
      const rec = getOrCreateRecord({ ...params, acpSessionId, now })
      trackUsage(rec, params, now)
      rec.lastSeenAt = now
      scheduleFlush()
    },

    onTurnEnded(agentId, acpSessionId, now) {
      if (acpSessionId === null) return
      const rec = sessions[acpSessionId]
      if (rec === undefined || rec.agentId !== agentId) return
      rec.turns += 1
      rec.lastSeenAt = now
      scheduleFlush()
    },

    listRecords(opts) {
      let list = Object.values(sessions)
      if (opts?.cwd !== undefined) {
        list = list.filter((r) => r.cwd === opts.cwd)
      }
      list.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      if (opts?.limit !== undefined && opts.limit > 0) {
        list = list.slice(0, opts.limit)
      }
      return list.map((r) => ({
        ...r,
        cycles: r.cycles.map((c) => ({ ...c })),
      }))
    },

    flushOnShutdown() {
      flushOnExit()
    },
  }
}
