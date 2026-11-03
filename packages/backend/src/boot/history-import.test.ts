import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { emptyLegacyImportStats } from "../history/legacy-record-schema.js"
import { runLegacyImport } from "../history/session-history-migration.js"
import { applySessionHistorySchema } from "../history/session-history-schema.js"
import { openSqliteDb } from "../history/sqlite-adapter.js"
import { runBootLegacyImport } from "./history-import.js"

describe("runBootLegacyImport", () => {
  let home: string
  let prevHome: string | undefined

  afterEach(() => {
    if (prevHome !== undefined) process.env.HOME = prevHome
    else delete process.env.HOME
    delete process.env.HISTORY_DB_FILE
    if (home) rmSync(home, { recursive: true, force: true })
  })

  it("HISTORY_DB_FILE override skips automatic import from home tree", async () => {
    home = mkdtempSync(join(tmpdir(), "dc-import-home-"))
    prevHome = process.env.HOME
    process.env.HOME = home
    const dbFile = join(home, "override.sqlite")
    process.env.HISTORY_DB_FILE = dbFile
    mkdirSync(join(home, ".config", "drive-coding", "token-usage"), { recursive: true })
    writeFileSync(join(home, ".config", "drive-coding", "token-usage", "sessions.json"), "{}")
    await runBootLegacyImport({}, process.env)
    expect(existsSync(dbFile)).toBe(false)
  })

  it("explicit legacySources imports even with override", async () => {
    home = mkdtempSync(join(tmpdir(), "dc-import-fix-"))
    prevHome = process.env.HOME
    process.env.HOME = home
    const dbFile = join(home, "override.sqlite")
    process.env.HISTORY_DB_FILE = dbFile
    const usagePath = join(home, "usage.json")
    writeFileSync(
      usagePath,
      JSON.stringify({
        s1: {
          acpSessionId: "s1",
          agentId: "a1",
          cliKind: "claude",
          cwd: "/p",
          firstSeenAt: 1,
          lastSeenAt: 2,
          turns: 0,
          lastUsed: 1,
          size: 1,
          cycles: [{ startedAt: 1, peakUsed: 1, closedAt: null }],
          cyclesTruncated: false,
        },
      }),
    )
    await runBootLegacyImport({}, process.env, {
      legacySources: { usageJsonPath: usagePath },
      deadlineAt: Date.now() + 3000,
    })
    expect(existsSync(dbFile)).toBe(true)
  })
})

/**
 * ─── legacy-import-validation ───
 * Before this round a single malformed legacy record raised
 * `NOT NULL constraint failed: sessions.cliKind` out of `runBootLegacyImport`.
 * `prepareBoot()` is awaited without a catch (run-server.ts), so the backend exited 1
 * and — because the migration marker lives in the transaction that failed — every later
 * boot repeated it. Measured live before the fix: `listening` logged 0 times, twice in a row.
 */
describe("boot import survives malformed legacy records", () => {
  it("imports the good records, skips the bad one, and does not throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-boot-malformed-"))
    try {
      const usagePath = join(dir, "sessions.json")
      const good = {
        acpSessionId: "good-1",
        agentId: "a1",
        cliKind: "claude",
        cwd: "/p",
        firstSeenAt: 1,
        lastSeenAt: 2,
        turns: 0,
        lastUsed: 1,
        size: 1,
        cycles: [{ startedAt: 1, peakUsed: 1, closedAt: null }],
        cyclesTruncated: false,
      }
      const { cliKind: _drop, ...bad } = good
      writeFileSync(
        usagePath,
        JSON.stringify({ "good-1": good, "bad-1": { ...bad, acpSessionId: "bad-1" } }),
      )

      const dbPath = join(dir, "history.sqlite")
      const db = openSqliteDb(dbPath)
      applySessionHistorySchema(db)
      const stats = emptyLegacyImportStats()
      const result = runLegacyImport({ db, legacySources: { usageJsonPath: usagePath }, stats })

      expect(result).toBe("imported")
      expect(stats.usageSkipped).toBe(1)
      expect(db.prepare("SELECT count(*) AS c FROM sessions").get<{ c: number }>()?.c).toBe(1)
      // The marker IS written — so the next boot skips instead of retrying the failure.
      // One ledger holds both kinds: `schema-v1` (shape) and the data import. They are
      // separate questions — a fresh install is a valid v1 with nothing imported.
      expect(
        db
          .prepare("SELECT migrationId FROM history_migrations ORDER BY migrationId")
          .all<{ migrationId: string }>()
          .map((r) => r.migrationId),
      ).toEqual(["import-legacy-json-v1", "schema-v1"])
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
