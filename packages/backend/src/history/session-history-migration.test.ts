/**
 * session-history-migration.test.ts — legacy JSON import (brief Commit 3).
 */

import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  LEGACY_IMPORT_MIGRATION_ID,
  LegacyImportError,
  runLegacyImport,
  vacuumIntoBackup,
} from "./session-history-migration.js"
import { applySessionHistorySchema } from "./session-history-schema.js"
import { createSessionHistoryStore } from "./session-history-store.js"
import { openSqliteDb } from "./sqlite-adapter.js"

const workerDir = fileURLToPath(new URL(".", import.meta.url))
const workerScript = join(workerDir, "migration-subprocess-entry.ts")

describe("runLegacyImport", () => {
  let dir: string
  let dbPath: string
  let usagePath: string
  let projectsPath: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function setupFixtures() {
    dir = mkdtempSync(join(tmpdir(), "dc-hist-mig-"))
    dbPath = join(dir, "history.sqlite")
    usagePath = join(dir, "sessions.json")
    projectsPath = join(dir, "projects-registry.json")
    writeFileSync(
      usagePath,
      JSON.stringify({
        s1: {
          acpSessionId: "s1",
          agentId: "a1",
          cliKind: "claude",
          cwd: "/proj-a",
          firstSeenAt: 1000,
          lastSeenAt: 2000,
          turns: 2,
          lastUsed: 50_000,
          size: 1_000_000,
          cycles: [{ startedAt: 1000, peakUsed: 50_000, closedAt: null }],
          cyclesTruncated: false,
          costAmount: 0.5,
          costCurrency: "USD",
        },
      }),
    )
    writeFileSync(
      projectsPath,
      JSON.stringify({
        projects: [
          {
            cwd: "/proj-a",
            kind: "claude",
            lastSeen: new Date(2000).toISOString(),
            lastSessionId: "s1",
          },
          {
            cwd: "/legacy-no-sid",
            kind: "opencode",
            lastSeen: new Date(3000).toISOString(),
          },
        ],
      }),
    )
  }

  function openDb() {
    const db = openSqliteDb(dbPath)
    applySessionHistorySchema(db)
    return db
  }

  it("imports fixtures and second run skips", () => {
    setupFixtures()
    const db = openDb()
    expect(
      runLegacyImport({
        db,
        legacySources: { usageJsonPath: usagePath, projectsJsonPath: projectsPath },
      }),
    ).toBe("imported")
    const store = createSessionHistoryStore(dbPath)
    const rec = store.listUsageRecords()[0]
    expect(rec?.costCurrency).toBe("USD")
    expect(rec?.cycles[0]?.closedAt).toBeNull()
    expect(store.listProjects().some((p) => p.cwd === "/legacy-no-sid")).toBe(true)
    store.close()
    expect(
      runLegacyImport({
        db,
        legacySources: { usageJsonPath: usagePath, projectsJsonPath: projectsPath },
      }),
    ).toBe("skipped")
    db.close()
  })

  it("hides cwd present in usage but absent from projects registry", () => {
    setupFixtures()
    writeFileSync(projectsPath, JSON.stringify({ projects: [] }))
    const db = openDb()
    runLegacyImport({
      db,
      legacySources: { usageJsonPath: usagePath, projectsJsonPath: projectsPath },
    })
    db.close()
    const store = createSessionHistoryStore(dbPath)
    expect(store.listProjects().some((p) => p.cwd === "/proj-a")).toBe(false)
    expect(store.listProjects({ includeHidden: true }).some((p) => p.cwd === "/proj-a")).toBe(true)
    store.close()
  })

  it("missing source path is a valid no_sources branch", () => {
    setupFixtures()
    const db = openDb()
    expect(runLegacyImport({ db, legacySources: {} })).toBe("no_sources")
    db.close()
  })

  it("corrupt JSON throws LegacyImportError and leaves source bytes", () => {
    setupFixtures()
    writeFileSync(usagePath, "{not-json")
    const db = openDb()
    expect(() => runLegacyImport({ db, legacySources: { usageJsonPath: usagePath } })).toThrow(
      LegacyImportError,
    )
    expect(readFileSync(usagePath, "utf8")).toBe("{not-json")
    db.close()
  })

  it("VACUUM INTO backup opens with imported rows", () => {
    setupFixtures()
    const db = openDb()
    runLegacyImport({
      db,
      legacySources: { usageJsonPath: usagePath, projectsJsonPath: projectsPath },
    })
    const backup = join(dir, "backup.sqlite")
    vacuumIntoBackup(db, backup)
    db.close()
    const copy = openSqliteDb(backup)
    const n = copy.prepare("SELECT count(*) AS n FROM sessions").get<{ n: number }>()?.n
    expect(n).toBeGreaterThan(0)
    copy.close()
  })

  it("two processes import once with integrity ok", async () => {
    setupFixtures()
    const db = openDb()
    expect(
      runLegacyImport({
        db,
        legacySources: { usageJsonPath: usagePath, projectsJsonPath: projectsPath },
      }),
    ).toBe("imported")
    db.close()

    function runWorker(): Promise<{ result: string; integrity: string }> {
      return new Promise((resolve, reject) => {
        const child = spawn("bun", [workerScript, dbPath, usagePath, projectsPath], {
          cwd: workerDir,
          env: { ...process.env, HISTORY_DB_FILE: dbPath },
        })
        let out = ""
        child.stdout.on("data", (chunk) => {
          out += String(chunk)
        })
        child.on("error", reject)
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`worker exit ${code}: ${out}`))
            return
          }
          const line = out.trim().split("\n").pop() ?? ""
          resolve(JSON.parse(line) as { result: string; integrity: string })
        })
      })
    }

    const second = await runWorker()
    expect(second.result).toBe("skipped")
    const parsed = [second]
    expect(parsed.filter((p) => p.result === "skipped")).toHaveLength(1)
    expect(parsed.every((p) => p.integrity === "ok")).toBe(true)
    const verifyDb = openDb()
    const mark = verifyDb
      .prepare("SELECT migrationId FROM history_migrations WHERE migrationId = ?")
      .get(LEGACY_IMPORT_MIGRATION_ID)
    expect(mark).toBeDefined()
    expect(
      verifyDb.prepare("PRAGMA integrity_check").get<{ integrity_check: string }>()
        ?.integrity_check,
    ).toBe("ok")
    verifyDb.close()
  })

  it("transaction rollback leaves no migration marker", () => {
    setupFixtures()
    const db = openDb()
    expect(() =>
      db.transaction(() => {
        db.prepare("INSERT INTO history_migrations (migrationId, completedAt) VALUES (?, ?)").run(
          LEGACY_IMPORT_MIGRATION_ID,
          Date.now(),
        )
        throw new Error("abort")
      }),
    ).toThrow("abort")
    const mark = db
      .prepare("SELECT migrationId FROM history_migrations WHERE migrationId = ?")
      .get(LEGACY_IMPORT_MIGRATION_ID)
    expect(mark).toBeUndefined()
    db.close()
  })

  it("two parallel worker processes on empty DB import exactly once", async () => {
    setupFixtures()

    function runWorker(): Promise<{ result: string }> {
      return new Promise((resolve, reject) => {
        const child = spawn("bun", [workerScript, dbPath, usagePath, projectsPath], {
          cwd: workerDir,
          env: { ...process.env, HISTORY_DB_FILE: dbPath },
        })
        let out = ""
        child.stdout.on("data", (chunk) => {
          out += String(chunk)
        })
        child.stderr.on("data", (chunk) => {
          out += String(chunk)
        })
        child.on("error", reject)
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`worker exit ${code}: ${out}`))
            return
          }
          const line = out.trim().split("\n").pop() ?? ""
          resolve(JSON.parse(line) as { result: string })
        })
      })
    }

    const parsed = await Promise.all([runWorker(), runWorker()])
    expect(parsed.map((p) => p.result).sort()).toEqual(["imported", "skipped"])
    const verifyDb = openDb()
    const n = verifyDb.prepare("SELECT count(*) AS n FROM sessions").get<{ n: number }>()?.n ?? 0
    expect(n).toBeGreaterThan(0)
    verifyDb.close()
  })
})
