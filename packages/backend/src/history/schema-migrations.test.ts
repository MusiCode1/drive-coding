/**
 * schema-migrations.test.ts — the runner, proven on real transitions.
 *
 * No fictional v2 lives in product code: the multi-step and ALTER paths are proven with
 * an injected step list, and the column check stays ON (the test supplies its own
 * expectation) rather than being switched off — a disabled check proves nothing.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  columnDrift,
  runSchemaMigrations,
  SCHEMA_STEPS,
  SchemaDriftError,
  type SchemaStep,
  SchemaVersionError,
  SESSION_HISTORY_USER_VERSION,
} from "./schema-migrations.js"
import { vacuumIntoBackup } from "./session-history-migration.js"
import { applySessionHistorySchema } from "./session-history-schema.js"
import { listSessionTableColumns, SESSION_TABLE_COLUMNS } from "./session-history-schema-ddl.js"
import { openSqliteDb, type SqliteDb } from "./sqlite-adapter.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function scratch(name = "history.sqlite"): string {
  const dir = mkdtempSync(join(tmpdir(), "dc-schema-mig-"))
  dirs.push(dir)
  return join(dir, name)
}

function version(db: SqliteDb): number {
  return db.prepare("PRAGMA user_version").get<{ user_version: number }>()?.user_version ?? 0
}

function ledger(db: SqliteDb): string[] {
  return db
    .prepare("SELECT migrationId FROM history_migrations ORDER BY migrationId")
    .all<{ migrationId: string }>()
    .map((r) => r.migrationId)
}

describe("v0 → v1, the transition that actually exists", () => {
  it("stamps the version, records the step, and is a no-op on the second run", () => {
    const db = openSqliteDb(scratch())
    expect(version(db)).toBe(0)

    expect(runSchemaMigrations(db)).toBe(SESSION_HISTORY_USER_VERSION)
    expect(version(db)).toBe(1)
    expect(listSessionTableColumns(db).sort()).toEqual([...SESSION_TABLE_COLUMNS].sort())
    expect(ledger(db)).toEqual(["schema-v1"])

    const completedAt = db
      .prepare("SELECT completedAt FROM history_migrations WHERE migrationId = ?")
      .get<{ completedAt: number }>("schema-v1")?.completedAt
    expect(runSchemaMigrations(db)).toBe(1)
    expect(
      db
        .prepare("SELECT completedAt FROM history_migrations WHERE migrationId = ?")
        .get<{ completedAt: number }>("schema-v1")?.completedAt,
    ).toBe(completedAt) // untouched — the second run did not re-run the step
    db.close()
  })

  it("the version is derived from the steps, not hand-maintained", () => {
    expect(SESSION_HISTORY_USER_VERSION).toBe(SCHEMA_STEPS[SCHEMA_STEPS.length - 1]?.to)
  })
})

describe("a shape that does not match is refused, and nothing is written", () => {
  /** The exact failure measured on the old code: 8 columns in, 8 columns out, stamped v1. */
  function olderShape(): SqliteDb {
    const db = openSqliteDb(scratch())
    db.exec(`CREATE TABLE sessions (
      cliKind TEXT NOT NULL, acpSessionId TEXT NOT NULL, agentId TEXT NOT NULL, cwd TEXT NOT NULL,
      firstSeenAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL, lastAttachedAt INTEGER NOT NULL,
      turns INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (cliKind, acpSessionId))`)
    db.prepare("INSERT INTO sessions VALUES ('claude','s1','a1','/p',1,2,2,0)").run()
    return db
  }

  it("raises SchemaDriftError naming the missing columns", () => {
    const db = olderShape()
    expect(() => applySessionHistorySchema(db)).toThrow(SchemaDriftError)
    db.close()
  })

  it("🔴 leaves user_version at 0 — the old code stamped it v1 and wedged the file", () => {
    const db = olderShape()
    try {
      applySessionHistorySchema(db)
    } catch {
      /* asserted above */
    }
    expect(version(db)).toBe(0)
    expect(db.prepare("SELECT count(*) AS c FROM sessions").get<{ c: number }>()?.c).toBe(1)
    db.close()
  })
})

describe("a database newer than this build", () => {
  it("is refused instead of being used as if understood", () => {
    const db = openSqliteDb(scratch())
    db.exec("PRAGMA user_version = 99")
    expect(() => runSchemaMigrations(db)).toThrow(SchemaVersionError)
    expect(version(db)).toBe(99)
    db.close()
  })
})

describe("the runner itself — multi-step and ALTER on populated data", () => {
  const EXTRA = "experimentLabel"
  const stepTwo: SchemaStep = {
    to: 2,
    label: "test-only-add-column",
    up: (db) => db.exec(`ALTER TABLE sessions ADD COLUMN ${EXTRA} TEXT`),
  }
  const steps = [...SCHEMA_STEPS, stepTwo]
  const expectedAfter = [...SESSION_TABLE_COLUMNS, EXTRA]

  it("runs pending steps in order and carries the data through ALTER", () => {
    const file = scratch()
    const db = openSqliteDb(file)
    runSchemaMigrations(db) // land at v1 first, then populate
    db.prepare(
      `INSERT INTO sessions (cliKind, acpSessionId, agentId, cwd, firstSeenAt, lastSeenAt,
       lastAttachedAt, turns) VALUES ('claude','keep-me','a1','/p',1,2,2,7)`,
    ).run()

    const backups: number[] = []
    expect(
      runSchemaMigrations(db, {
        steps,
        expectedColumns: expectedAfter,
        backup: (from) => {
          backups.push(from)
          vacuumIntoBackup(db, `${file}.pre-v${from}.bak`)
        },
      }),
    ).toBe(2)

    expect(version(db)).toBe(2)
    expect(listSessionTableColumns(db)).toContain(EXTRA)
    expect(ledger(db)).toEqual(["schema-v1", "schema-v2"])
    const row = db
      .prepare("SELECT turns FROM sessions WHERE acpSessionId = ?")
      .get<{ turns: number }>("keep-me")
    expect(row?.turns).toBe(7) // the row survived the ALTER

    // the backup was taken before the mutating step, from the version we were at
    expect(backups).toEqual([1])
    expect(existsSync(`${file}.pre-v1.bak`)).toBe(true)
    const backup = openSqliteDb(`${file}.pre-v1.bak`)
    expect(listSessionTableColumns(backup)).not.toContain(EXTRA)
    expect(backup.prepare("SELECT count(*) AS c FROM sessions").get<{ c: number }>()?.c).toBe(1) // and it holds the data, so a rollback is possible
    backup.close()
    db.close()
  })

  it("a step whose result misses an expected column rolls the whole run back", () => {
    const db = openSqliteDb(scratch())
    runSchemaMigrations(db)
    const liar: SchemaStep = { to: 2, label: "claims-a-column-it-never-adds", up: () => {} }
    expect(() =>
      runSchemaMigrations(db, { steps: [...SCHEMA_STEPS, liar], expectedColumns: expectedAfter }),
    ).toThrow(SchemaDriftError)
    expect(version(db)).toBe(1)
    expect(ledger(db)).toEqual(["schema-v1"])
    db.close()
  })

  it("no backup is taken for a database that does not exist yet", () => {
    const db = openSqliteDb(scratch())
    const backups: number[] = []
    runSchemaMigrations(db, { backup: (from) => backups.push(from) })
    expect(backups).toEqual([]) // nothing to save at v0
    db.close()
  })
})

describe("columnDrift", () => {
  it("reports both directions", () => {
    const db = openSqliteDb(scratch())
    runSchemaMigrations(db)
    expect(columnDrift(db)).toEqual({ missing: [], unexpected: [] })
    expect(columnDrift(db, [...SESSION_TABLE_COLUMNS, "ghost"]).missing).toEqual(["ghost"])
    const partial = SESSION_TABLE_COLUMNS.filter((c) => c !== "roleLabel")
    expect(columnDrift(db, partial).unexpected).toEqual(["roleLabel"])
    db.close()
  })
})
