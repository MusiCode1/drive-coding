/**
 * legacy-import-fidelity.test.ts — what the legacy JSON held must be what SQLite holds.
 *
 * The suite had no such assertion: it checked `costCurrency` and `cycles[0].closedAt`
 * of ONE record. Everything else — field values, cycle order, how many records arrived —
 * was unmeasured. Fixtures are fully synthetic (this repo is public).
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { emptyLegacyImportStats } from "./legacy-record-schema.js"
import { runLegacyImport } from "./session-history-migration.js"
import { applySessionHistorySchema } from "./session-history-schema.js"
import { openSqliteDb, type SqliteDb } from "./sqlite-adapter.js"

const USAGE_FIXTURE = new URL("./__fixtures__/legacy-sessions.sample.json", import.meta.url)
  .pathname
const PROJECTS_FIXTURE = new URL("./__fixtures__/legacy-projects.sample.json", import.meta.url)
  .pathname

type Cycle = { startedAt: number; peakUsed: number; closedAt: number | null }
type SessionRow = {
  agentId: string
  cwd: string
  firstSeenAt: number
  lastSeenAt: number
  turns: number
}
type UsageRow = {
  lastUsed: number
  size: number
  cyclesTruncated: number
  costAmount: number | null
  costCurrency: string | null
}
type Rec = {
  acpSessionId: string
  agentId: string
  cliKind: string
  cwd: string
  firstSeenAt: number
  lastSeenAt: number
  turns: number
  lastUsed: number
  size: number
  cycles: Cycle[]
  cyclesTruncated: boolean
  costAmount?: number
  costCurrency?: string
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function importFixtures(): { db: SqliteDb; stats: ReturnType<typeof emptyLegacyImportStats> } {
  const dir = mkdtempSync(join(tmpdir(), "dc-fidelity-"))
  dirs.push(dir)
  const db = openSqliteDb(join(dir, "history.sqlite"))
  applySessionHistorySchema(db)
  const stats = emptyLegacyImportStats()
  const result = runLegacyImport({
    db,
    legacySources: { usageJsonPath: USAGE_FIXTURE, projectsJsonPath: PROJECTS_FIXTURE },
    stats,
  })
  expect(result).toBe("imported")
  return { db, stats }
}

/** Records the import is expected to accept: well-formed, plus the bad-optional one. */
async function expectedRecords(): Promise<Rec[]> {
  const raw = (await import("./__fixtures__/legacy-sessions.sample.json", {
    with: { type: "json" },
  })) as { default: Record<string, unknown> }
  return Object.values(raw.default).filter((v): v is Rec => {
    const r = v as Partial<Rec>
    return typeof r.acpSessionId === "string" && !r.acpSessionId.startsWith("bad-")
  })
}

describe("legacy import fidelity", () => {
  it("every accepted record arrives with every field intact", async () => {
    const { db } = importFixtures()
    const expected = await expectedRecords()
    expect(expected.length).toBeGreaterThan(20)

    for (const rec of expected) {
      const row = db
        .prepare(
          `SELECT agentId, cwd, firstSeenAt, lastSeenAt, turns
           FROM sessions WHERE cliKind = ? AND acpSessionId = ?`,
        )
        .get<SessionRow>(rec.cliKind, rec.acpSessionId)
      expect(row, `session ${rec.acpSessionId}`).toBeDefined()
      expect(row?.agentId).toBe(rec.agentId)
      expect(row?.cwd).toBe(rec.cwd)
      expect(row?.firstSeenAt).toBe(rec.firstSeenAt)
      expect(row?.lastSeenAt).toBe(rec.lastSeenAt)
      expect(row?.turns).toBe(rec.turns)

      const usage = db
        .prepare(
          `SELECT lastUsed, size, cyclesTruncated, costAmount, costCurrency
           FROM session_usage WHERE cliKind = ? AND acpSessionId = ?`,
        )
        .get<UsageRow>(rec.cliKind, rec.acpSessionId)
      expect(usage, `usage ${rec.acpSessionId}`).toBeDefined()
      expect(usage?.lastUsed).toBe(rec.lastUsed)
      expect(usage?.size).toBe(rec.size)
      expect(usage?.cyclesTruncated).toBe(rec.cyclesTruncated ? 1 : 0)
      // the one record with a non-numeric costAmount keeps its currency, loses the amount
      const expectAmount = typeof rec.costAmount === "number" ? rec.costAmount : null
      expect(usage?.costAmount).toBe(expectAmount)
      expect(usage?.costCurrency).toBe(rec.costCurrency ?? null)
    }
    db.close()
  })

  it("cycles keep their order and their values, including the 19-cycle record", async () => {
    const { db } = importFixtures()
    const expected = await expectedRecords()
    const longest = expected.reduce((a, b) => (a.cycles.length >= b.cycles.length ? a : b))
    expect(longest.cycles.length).toBe(19)

    for (const rec of expected) {
      const rows = db
        .prepare(
          `SELECT cycleIndex, startedAt, peakUsed, closedAt FROM usage_cycles
           WHERE cliKind = ? AND acpSessionId = ? ORDER BY cycleIndex`,
        )
        .all<{ cycleIndex: number; startedAt: number; peakUsed: number; closedAt: number | null }>(
          rec.cliKind,
          rec.acpSessionId,
        )
      expect(rows.length, `cycles of ${rec.acpSessionId}`).toBe(rec.cycles.length)
      rows.forEach((row, i) => {
        expect(row.cycleIndex).toBe(i)
        expect(row.startedAt).toBe(rec.cycles[i]?.startedAt)
        expect(row.peakUsed).toBe(rec.cycles[i]?.peakUsed)
        expect(row.closedAt).toBe(rec.cycles[i]?.closedAt ?? null)
      })
    }
    db.close()
  })

  it("counts every malformed record instead of dropping it silently", () => {
    const { db, stats } = importFixtures()
    // four unusable usage records; the fifth is usable with one field dropped
    expect(stats.usageSkipped).toBe(4)
    expect(stats.fieldsDropped).toBe(1)
    // one project without `kind`
    expect(stats.projectsSkipped).toBe(1)
    // one project whose lastSeen is not a date
    expect(stats.unparsedLastSeen).toBe(1)
    // every skip is named — a count with no reason is not actionable
    expect(Object.keys(stats.reasons).length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(stats.reasons).some((r) => r.includes("cliKind"))).toBe(true)
    db.close()
  })

  it("no malformed record leaked into the database", () => {
    const { db } = importFixtures()
    const leaked = db
      .prepare("SELECT acpSessionId FROM sessions WHERE acpSessionId LIKE 'bad-%'")
      .all<{ acpSessionId: string }>()
    expect(leaked).toEqual([])
    db.close()
  })
})
