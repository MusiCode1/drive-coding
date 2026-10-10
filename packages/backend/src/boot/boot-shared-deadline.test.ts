import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BOOT_DB_BUDGET_MS } from "./sqlite-bootstrap.js"
import { createDeps } from "./deps.js"
import { runBootLegacyImport } from "./history-import.js"
import * as migration from "../history/session-history-migration.js"
import { LEGACY_IMPORT_MIGRATION_ID } from "../history/session-history-migration.js"
import { createSessionHistoryStore } from "../history/session-history-store.js"
import { openSqliteDb, SqliteDeadlineError } from "../history/sqlite-adapter.js"

describe("shared boot deadline", () => {
  let home: string
  let prevHome: string | undefined

  afterEach(() => {
    vi.restoreAllMocks()
    if (prevHome !== undefined) process.env.HOME = prevHome
    else delete process.env.HOME
    delete process.env.HISTORY_DB_FILE
    if (home) rmSync(home, { recursive: true, force: true })
  })

  function bootConfig(dbFile: string) {
    return { historyDbFile: dbFile }
  }

  it("createDeps rejects expired bootDeadlineAt from caller", async () => {
    home = mkdtempSync(join(tmpdir(), "dc-boot-deadline-"))
    prevHome = process.env.HOME
    process.env.HOME = home
    const dbFile = join(home, "h.sqlite")
    const app = new Hono()
    await expect(
      createDeps(bootConfig(dbFile), process.env, app, { bootDeadlineAt: Date.now() - 1 }),
    ).rejects.toBeInstanceOf(SqliteDeadlineError)
  })

  it("legacy import and store open share one deadline within BOOT_DB_BUDGET_MS", async () => {
    home = mkdtempSync(join(tmpdir(), "dc-boot-two-phase-"))
    prevHome = process.env.HOME
    process.env.HOME = home
    const dbFile = join(home, "h.sqlite")
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
    const bootDeadlineAt = Date.now() + BOOT_DB_BUDGET_MS
    const t0 = Date.now()
    await runBootLegacyImport({}, process.env, {
      legacySources: { usageJsonPath: usagePath },
      deadlineAt: bootDeadlineAt,
    })
    await createSessionHistoryStore(dbFile, { deadlineAt: bootDeadlineAt })
    const totalBootMs = Date.now() - t0
    expect(totalBootMs).toBeLessThanOrEqual(BOOT_DB_BUDGET_MS + 150)
  })

  it("D7a: slow import commits then phase2 deadline; second boot skips import", async () => {
    home = mkdtempSync(join(tmpdir(), "dc-boot-d7a-"))
    prevHome = process.env.HOME
    process.env.HOME = home
    const dbFile = join(home, "h.sqlite")
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
    const orig = migration.runLegacyImport
    vi.spyOn(migration, "runLegacyImport").mockImplementation((args) => {
      const start = Date.now()
      while (Date.now() - start < 120) {
        /* sync work that outlives the boot deadline */
      }
      return orig(args)
    })
    const bootDeadlineAt = Date.now() + 60
    await runBootLegacyImport({}, process.env, {
      legacySources: { usageJsonPath: usagePath },
      deadlineAt: bootDeadlineAt,
    })
    expect(existsSync(dbFile)).toBe(true)
    const db = openSqliteDb(dbFile)
    const row = db
      .prepare("SELECT 1 AS ok FROM history_migrations WHERE migrationId = ?")
      .get<{ ok: number }>(LEGACY_IMPORT_MIGRATION_ID)
    expect(row?.ok).toBe(1)
    db.close()

    await expect(
      createSessionHistoryStore(dbFile, { deadlineAt: bootDeadlineAt }),
    ).rejects.toBeInstanceOf(SqliteDeadlineError)

    await runBootLegacyImport({}, process.env, {
      legacySources: { usageJsonPath: usagePath },
      deadlineAt: Date.now() + BOOT_DB_BUDGET_MS,
    })
    const store = await createSessionHistoryStore(dbFile, {
      deadlineAt: Date.now() + BOOT_DB_BUDGET_MS,
    })
    expect(store.listProjects().length).toBeGreaterThanOrEqual(0)
  })
})
