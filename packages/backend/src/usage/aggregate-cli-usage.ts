/**
 * aggregate-cli-usage.ts — pure merge of CLI session rows + project folders by cliKind.
 */

import {
  compactionsFromCycles,
  peakOfCycles,
  sumOfCyclePeaks,
} from "@drive-coding/core/usage/cli-usage"
import type { ProjectEntry } from "../app/project-entry.js"
import type { CliSessionRow } from "../history/session-history-store.js"
import type { TokenUsageRecord } from "./token-usage-store.js"

export type CliUsageRow = {
  cliKind: string
  sessions: number
  reportsUsage: boolean
  lastSeenProjects: number
  lastSeenAtRegistry?: string
  turns: number
  firstSeenAt: number
  lastSeenAt: number
  peakUsed: number
  sumHeld: number
  compactions: number
  costAmount?: number
  costCurrency?: string
  costMixedCurrency?: true
}

function filterSessionRows(rows: readonly CliSessionRow[], cwd?: string): CliSessionRow[] {
  if (cwd === undefined || cwd === "") return [...rows]
  return rows.filter((r) => r.cwd === cwd)
}

function filterProjects(projects: readonly ProjectEntry[], cwd?: string): ProjectEntry[] {
  if (cwd === undefined || cwd === "") return [...projects]
  return projects.filter((p) => p.cwd === cwd)
}

function toUsageRecord(row: CliSessionRow): TokenUsageRecord | undefined {
  if (row.usage === undefined) return undefined
  const u = row.usage
  return {
    acpSessionId: "",
    agentId: "",
    cliKind: row.cliKind,
    cwd: row.cwd,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    turns: row.turns,
    lastUsed: u.lastUsed,
    size: u.size,
    cycles: u.cycles,
    cyclesTruncated: u.cyclesTruncated,
    ...(u.costAmount !== undefined ? { costAmount: u.costAmount } : {}),
    ...(u.costCurrency !== undefined ? { costCurrency: u.costCurrency } : {}),
  }
}

function aggregateCost(
  records: readonly TokenUsageRecord[],
): Pick<CliUsageRow, "costAmount" | "costCurrency" | "costMixedCurrency"> {
  const currencies = new Set<string>()
  for (const r of records) {
    if (r.costCurrency !== undefined) currencies.add(r.costCurrency)
  }

  const sumAmount = () => records.reduce((s, r) => s + (r.costAmount ?? 0), 0)

  if (currencies.size >= 2) {
    return { costMixedCurrency: true }
  }
  if (currencies.size === 1) {
    const costCurrency = [...currencies][0]!
    return { costAmount: sumAmount(), costCurrency }
  }
  const total = sumAmount()
  if (total === 0 && records.every((r) => r.costAmount === undefined)) {
    return {}
  }
  return { costAmount: total }
}

function rowFromUsageRecords(recs: TokenUsageRecord[]): Partial<CliUsageRow> {
  if (recs.length === 0) {
    return {
      peakUsed: 0,
      sumHeld: 0,
      compactions: 0,
    }
  }
  return {
    peakUsed: Math.max(...recs.map((r) => peakOfCycles(r.cycles))),
    sumHeld: recs.reduce((s, r) => s + sumOfCyclePeaks(r.cycles), 0),
    compactions: recs.reduce((s, r) => s + compactionsFromCycles(r.cycles), 0),
    ...aggregateCost(recs),
  }
}

function rowFromSessionRows(cliKind: string, rows: CliSessionRow[]): Partial<CliUsageRow> {
  if (rows.length === 0) {
    return {
      sessions: 0,
      reportsUsage: false,
      turns: 0,
      firstSeenAt: 0,
      lastSeenAt: 0,
      peakUsed: 0,
      sumHeld: 0,
      compactions: 0,
    }
  }
  const usageRecs = rows.map(toUsageRecord).filter((r): r is TokenUsageRecord => r !== undefined)
  return {
    sessions: rows.length,
    reportsUsage: usageRecs.length > 0,
    turns: rows.reduce((s, r) => s + r.turns, 0),
    firstSeenAt: Math.min(...rows.map((r) => r.firstSeenAt)),
    lastSeenAt: Math.max(...rows.map((r) => r.lastSeenAt)),
    ...rowFromUsageRecords(usageRecs),
  }
}

function projectsStats(
  cliKind: string,
  projects: readonly ProjectEntry[],
): Pick<CliUsageRow, "lastSeenProjects" | "lastSeenAtRegistry"> {
  const matching = projects.filter((p) => p.kind === cliKind)
  if (matching.length === 0) {
    return { lastSeenProjects: 0 }
  }
  const lastSeenAtRegistry = matching.reduce(
    (max, p) => (p.lastSeen > max ? p.lastSeen : max),
    matching[0]!.lastSeen,
  )
  return { lastSeenProjects: matching.length, lastSeenAtRegistry }
}

export function aggregateCliUsage(
  sessionRows: readonly CliSessionRow[],
  projects: readonly ProjectEntry[],
  opts?: { cwd?: string },
): CliUsageRow[] {
  const cwd = opts?.cwd
  const filteredRows = filterSessionRows(sessionRows, cwd)
  const filteredProjects = filterProjects(projects, cwd)

  const kinds = new Set<string>()
  for (const r of filteredRows) kinds.add(r.cliKind)
  for (const p of filteredProjects) kinds.add(p.kind)

  const byKind = new Map<string, CliSessionRow[]>()
  for (const r of filteredRows) {
    const list = byKind.get(r.cliKind) ?? []
    list.push(r)
    byKind.set(r.cliKind, list)
  }

  return [...kinds].sort((a, b) => a.localeCompare(b)).map((cliKind) => {
    const rows = byKind.get(cliKind) ?? []
    const fromSessions = rowFromSessionRows(cliKind, rows)
    const fromProjects = projectsStats(cliKind, filteredProjects)
    return {
      cliKind,
      sessions: fromSessions.sessions ?? 0,
      reportsUsage: fromSessions.reportsUsage ?? false,
      lastSeenProjects: fromProjects.lastSeenProjects,
      ...(fromProjects.lastSeenAtRegistry !== undefined
        ? { lastSeenAtRegistry: fromProjects.lastSeenAtRegistry }
        : {}),
      turns: fromSessions.turns ?? 0,
      firstSeenAt: fromSessions.firstSeenAt ?? 0,
      lastSeenAt: fromSessions.lastSeenAt ?? 0,
      peakUsed: fromSessions.peakUsed ?? 0,
      sumHeld: fromSessions.sumHeld ?? 0,
      compactions: fromSessions.compactions ?? 0,
      ...(fromSessions.costAmount !== undefined ? { costAmount: fromSessions.costAmount } : {}),
      ...(fromSessions.costCurrency !== undefined ? { costCurrency: fromSessions.costCurrency } : {}),
      ...(fromSessions.costMixedCurrency !== undefined
        ? { costMixedCurrency: fromSessions.costMixedCurrency }
        : {}),
    }
  })
}
