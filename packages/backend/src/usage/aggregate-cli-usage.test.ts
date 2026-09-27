import { describe, expect, it } from "vitest"
import type { ProjectEntry } from "../app/projects-registry.js"
import { aggregateCliUsage } from "./aggregate-cli-usage.js"
import type { TokenUsageRecord } from "./token-usage-store.js"

function rec(
  over: Partial<TokenUsageRecord> & Pick<TokenUsageRecord, "acpSessionId" | "cliKind">,
): TokenUsageRecord {
  return {
    agentId: "a1",
    cwd: "/proj",
    firstSeenAt: 1000,
    lastSeenAt: 2000,
    turns: 1,
    lastUsed: 100,
    size: 100,
    cycles: [{ startedAt: 1000, peakUsed: 50, closedAt: null }],
    cyclesTruncated: false,
    ...over,
  }
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

  it("merges two acpSessionId of same CLI into one row with sessions 2", () => {
    const records = [
      rec({ acpSessionId: "s1", cliKind: "claude" }),
      rec({ acpSessionId: "s2", cliKind: "claude", firstSeenAt: 500, lastSeenAt: 3000 }),
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
      rec({ acpSessionId: "s1", cliKind: "claude", costAmount: 1, costCurrency: "USD" }),
      rec({ acpSessionId: "s2", cliKind: "claude", costAmount: 2, costCurrency: "EUR" }),
    ]
    const row = aggregateCliUsage(records, [])[0]!
    expect(row.costMixedCurrency).toBe(true)
    expect(row.costAmount).toBeUndefined()
  })

  it("sums cost when USD and a record without currency (undefined is not a currency)", () => {
    const records = [
      rec({ acpSessionId: "s1", cliKind: "codex", costAmount: 1.5, costCurrency: "USD" }),
      rec({ acpSessionId: "s2", cliKind: "codex", costAmount: 0.5 }),
    ]
    const row = aggregateCliUsage(records, [])[0]!
    expect(row.costAmount).toBe(2)
    expect(row.costCurrency).toBe("USD")
    expect(row.costMixedCurrency).toBeUndefined()
  })

  it("filters both sources by cwd and lastSeenProjects is at most 1", () => {
    const records = [
      rec({ acpSessionId: "s1", cliKind: "claude", cwd: "/only" }),
      rec({ acpSessionId: "s2", cliKind: "claude", cwd: "/other" }),
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
      rec({
        acpSessionId: "s1",
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
