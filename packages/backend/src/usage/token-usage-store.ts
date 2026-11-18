/**
 * token-usage-store.ts — per-session context usage summary (cycles, cost), pure logic.
 *
 * Distinct from usage-store.ts (TTS metering). Persistence lives in session-history-store.
 * slice token-usage-persistence · session-history-sqlite
 */

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

/** Legacy consumer surface — wired to SessionHistoryStore until Commit 5 cutover. */
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
