/**
 * aggregate-cli-usage.ts — pure merge of token records + projects registry by cliKind.
 * slice usage-per-cli
 */

import {
  compactionsFromCycles,
  peakOfCycles,
  sumOfCyclePeaks,
} from "@drive-coding/core/usage/cli-usage"
import type { ProjectEntry } from "../app/projects-registry.js"
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

function filterRecords(records: readonly TokenUsageRecord[], cwd?: string): TokenUsageRecord[] {
  if (cwd === undefined || cwd === "") return [...records]
  return records.filter((r) => r.cwd === cwd)
}

function filterProjects(projects: readonly ProjectEntry[], cwd?: string): ProjectEntry[] {
  if (cwd === undefined || cwd === "") return [...projects]
  return projects.filter((p) => p.cwd === cwd)
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

function rowFromRecords(cliKind: string, recs: TokenUsageRecord[]): Partial<CliUsageRow> {
  if (recs.length === 0) {
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
  return {
    sessions: recs.length,
    reportsUsage: recs.length > 0,
    turns: recs.reduce((s, r) => s + r.turns, 0),
    firstSeenAt: Math.min(...recs.map((r) => r.firstSeenAt)),
    lastSeenAt: Math.max(...recs.map((r) => r.lastSeenAt)),
    peakUsed: Math.max(...recs.map((r) => peakOfCycles(r.cycles))),
    sumHeld: recs.reduce((s, r) => s + sumOfCyclePeaks(r.cycles), 0),
    compactions: recs.reduce((s, r) => s + compactionsFromCycles(r.cycles), 0),
    ...aggregateCost(recs),
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
  records: readonly TokenUsageRecord[],
  projects: readonly ProjectEntry[],
  opts?: { cwd?: string },
): CliUsageRow[] {
  const cwd = opts?.cwd
  const filteredRecords = filterRecords(records, cwd)
  const filteredProjects = filterProjects(projects, cwd)

  const kinds = new Set<string>()
  for (const r of filteredRecords) kinds.add(r.cliKind)
  for (const p of filteredProjects) kinds.add(p.kind)

  const byKind = new Map<string, TokenUsageRecord[]>()
  for (const r of filteredRecords) {
    const list = byKind.get(r.cliKind) ?? []
    list.push(r)
    byKind.set(r.cliKind, list)
  }

  const rows: CliUsageRow[] = [...kinds]
    .sort((a, b) => a.localeCompare(b))
    .map((cliKind) => {
      const recs = byKind.get(cliKind) ?? []
      const fromRecs = rowFromRecords(cliKind, recs)
      const fromProjects = projectsStats(cliKind, filteredProjects)
      return {
        cliKind,
        sessions: fromRecs.sessions ?? 0,
        reportsUsage: fromRecs.reportsUsage ?? false,
        lastSeenProjects: fromProjects.lastSeenProjects,
        ...(fromProjects.lastSeenAtRegistry !== undefined
          ? { lastSeenAtRegistry: fromProjects.lastSeenAtRegistry }
          : {}),
        turns: fromRecs.turns ?? 0,
        firstSeenAt: fromRecs.firstSeenAt ?? 0,
        lastSeenAt: fromRecs.lastSeenAt ?? 0,
        peakUsed: fromRecs.peakUsed ?? 0,
        sumHeld: fromRecs.sumHeld ?? 0,
        compactions: fromRecs.compactions ?? 0,
        ...(fromRecs.costAmount !== undefined ? { costAmount: fromRecs.costAmount } : {}),
        ...(fromRecs.costCurrency !== undefined ? { costCurrency: fromRecs.costCurrency } : {}),
        ...(fromRecs.costMixedCurrency !== undefined
          ? { costMixedCurrency: fromRecs.costMixedCurrency }
          : {}),
      }
    })

  return rows
}
