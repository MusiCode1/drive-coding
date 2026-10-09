import { describe, expect, it } from "vitest"
import type { ProjectEntry } from "../app/project-entry.js"
import type { CliSessionRow } from "../history/session-history-store.js"
import { aggregateCliUsage } from "./aggregate-cli-usage.js"

function cliRow(
  over: Partial<CliSessionRow> & Pick<CliSessionRow, "cliKind">,
): CliSessionRow {
  return {
    cwd: "/proj",
    firstSeenAt: 1000,
    lastSeenAt: 2000,
    turns: 1,
    ...over,
  }
}

function cliRowWithUsage(
  over: Partial<CliSessionRow> &
    Pick<CliSessionRow, "cliKind"> & {
      costAmount?: number
      costCurrency?: string
      cycles?: { startedAt: number; peakUsed: number; closedAt: number | null }[]
    },
): CliSessionRow {
  const { costAmount, costCurrency, cycles, ...rest } = over
  const row = cliRow(rest)
  row.usage = {
    lastUsed: 100,
    size: 100,
    cycles: cycles ?? [{ startedAt: 1000, peakUsed: 50, closedAt: null }],
    cyclesTruncated: false,
  }
  if (costAmount !== undefined) row.usage.costAmount = costAmount
  if (costCurrency !== undefined) row.usage.costCurrency = costCurrency
  return row
}

function proj(cwd: string, kind: string, lastSeen = "2026-09-27T12:00:00.000Z"): ProjectEntry {
  return { cwd, kind: kind as ProjectEntry["kind"], lastSeen }
}

describe("aggregateCliUsage", () => {
  it("includes cliKind only in projects with sessions 0 and reportsUsage false", () => {
    const rows = aggregateCliUsage([], [proj("/a", "cursor"), proj("/b", "cursor")])
    const cursor = rows.find((r) => r.cliKind === "cursor")
    expect(cursor).toBeDefined()
    expect(cursor!.sessions).toBe(0)
    expect(cursor!.reportsUsage).toBe(false)
    expect(cursor!.lastSeenProjects).toBe(2)
    expect(cursor!.lastSeenAtRegistry).toBe("2026-09-27T12:00:00.000Z")
  })

  it("sessions without usage: reportsUsage false but sessions counts rows", () => {
    const sessionRows = [
      cliRow({ cliKind: "claude" }),
      cliRow({ cliKind: "claude", cwd: "/p2", lastSeenAt: 3000 }),
    ]
    const rows = aggregateCliUsage(sessionRows, [])
    expect(rows[0]!.sessions).toBe(2)
    expect(rows[0]!.reportsUsage).toBe(false)
  })

  it("merges two session rows of same CLI into one row with sessions 2", () => {
    const records = [
      cliRowWithUsage({ cliKind: "claude" }),
      cliRowWithUsage({ cliKind: "claude", firstSeenAt: 500, lastSeenAt: 3000 }),
    ]
    const rows = aggregateCliUsage(records, [])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sessions).toBe(2)
    expect(rows[0]!.reportsUsage).toBe(true)
    expect(rows[0]!.firstSeenAt).toBe(500)
    expect(rows[0]!.lastSeenAt).toBe(3000)
  })

  it("sets costMixedCurrency when two defined currencies differ", () => {
    const records = [
      cliRowWithUsage({ cliKind: "claude", costAmount: 1, costCurrency: "USD" }),
      cliRowWithUsage({ cliKind: "claude", costAmount: 2, costCurrency: "EUR" }),
    ]
    const row = aggregateCliUsage(records, [])[0]!
    expect(row.costMixedCurrency).toBe(true)
    expect(row.costAmount).toBeUndefined()
  })

  it("sums cost when USD and a record without currency (undefined is not a currency)", () => {
    const records = [
      cliRowWithUsage({ cliKind: "codex", costAmount: 1.5, costCurrency: "USD" }),
      cliRowWithUsage({ cliKind: "codex", costAmount: 0.5 }),
    ]
    const row = aggregateCliUsage(records, [])[0]!
    expect(row.costAmount).toBe(2)
    expect(row.costCurrency).toBe("USD")
    expect(row.costMixedCurrency).toBeUndefined()
  })

  it("filters both sources by cwd and lastSeenProjects is at most 1", () => {
    const records = [
      cliRowWithUsage({ cliKind: "claude", cwd: "/only" }),
      cliRowWithUsage({ cliKind: "claude", cwd: "/other" }),
    ]
    const projects = [proj("/only", "claude"), proj("/other", "cursor")]
    const rows = aggregateCliUsage(records, projects, { cwd: "/only" })
    const claude = rows.find((r) => r.cliKind === "claude")
    expect(claude!.sessions).toBe(1)
    expect(claude!.lastSeenProjects).toBe(1)
    expect(rows.find((r) => r.cliKind === "cursor")).toBeUndefined()
  })

  it("aggregates sumHeld and compactions from cycles across records", () => {
    const records = [
      cliRowWithUsage({
        cliKind: "claude",
        cycles: [
          { startedAt: 1, peakUsed: 10, closedAt: 2 },
          { startedAt: 3, peakUsed: 20, closedAt: null },
        ],
      }),
    ]
    const row = aggregateCliUsage(records, [])[0]!
    expect(row.sumHeld).toBe(30)
    expect(row.compactions).toBe(1)
    expect(row.peakUsed).toBe(20)
  })
})
