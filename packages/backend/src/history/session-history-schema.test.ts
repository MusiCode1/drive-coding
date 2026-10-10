/**
 * session-history-schema.test.ts — pins that the version probe and the DDL run as
 * ONE transaction. Mutation control: drop the `db.transaction` wrapper in
 * session-history-schema.ts and the first case fails (calls come back tagged
 * "bare", with no begin/commit around them).
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SchemaVersionError } from "./schema-migrations.js"
import {
  applySessionHistorySchema,
  listSessionTableColumns,
  SESSION_HISTORY_USER_VERSION,
  SESSION_TABLE_COLUMNS,
} from "./session-history-schema.js"
import { openSqliteDb, type SqliteDb, type SqliteStatement } from "./sqlite-adapter.js"

/** Fake db that tags every call with whether it ran inside db.transaction(). */
function recordingDb(userVersion: number): { db: SqliteDb; calls: string[] } {
  const calls: string[] = []
  let inTx = false
  const tag = (): string => (inTx ? "tx" : "bare")
  const stmt: SqliteStatement = {
    run() {},
    get<T>(): T | undefined {
      return { user_version: userVersion } as unknown as T
    },
    all<T>(): T[] {
      return []
    },
  }
  const db: SqliteDb = {
    exec(sql: string) {
      calls.push(`${tag()}:exec:${sql.trim().slice(0, 24).replace(/\s+/g, " ")}`)
    },
    prepare(sql: string) {
      calls.push(`${tag()}:prepare:${sql}`)
      return stmt
    },
    transaction<T>(fn: () => T): T {
      calls.push("begin")
      inTx = true
      try {
        return fn()
      } finally {
        inTx = false
        calls.push("commit")
      }
    },
    close() {},
  }
  return { db, calls }
}

const dirs: string[] = []
function scratchDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "dc-schema-atomic-"))
  dirs.push(dir)
  return join(dir, "history.sqlite")
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe("applySessionHistorySchema atomicity", () => {
  // The intent of these three is unchanged since fix6 — the version probe and the
  // writes must be ONE unit. What moved is where the guarantee lives: the runner now
  // re-reads the version under BEGIN IMMEDIATE, so the assertion is "every call is
  // inside the transaction", not a fixed call sequence.
  it("every probe and every write happens inside one transaction", () => {
    const { db, calls } = recordingDb(0)
    // The column check is off here and ONLY here: this fake answers every query with
    // [], so it has no columns to report. Drift is proven against real files in
    // schema-migrations.test.ts; what this case owns is the transaction boundary.
    applySessionHistorySchema(db, { expectedColumns: null })

    // 🛑 No WRITE outside the transaction. One read is allowed and expected: the
    // pre-flight probe that decides whether a backup is worth taking, because
    // VACUUM INTO cannot run inside a transaction. It decides nothing that writes —
    // the authoritative read happens again under the lock, asserted below.
    expect(calls.filter((c) => c.startsWith("bare:exec"))).toEqual([])
    expect(calls.filter((c) => c.startsWith("bare:"))).toEqual(["bare:prepare:PRAGMA user_version"])
    expect(calls.at(-1)).toBe("commit")
    expect(calls.filter((c) => c === "begin")).toHaveLength(1)
    // 🔑 the version is read INSIDE — reading it outside is the race measured at
    // 9 failures per 500 before fix6
    expect(calls.some((c) => c === "tx:prepare:PRAGMA user_version")).toBe(true)
    expect(calls.some((c) => c.startsWith("tx:exec:CREATE TABLE"))).toBe(true)
    expect(
      calls.some((c) => c === `tx:exec:PRAGMA user_version = ${SESSION_HISTORY_USER_VERSION}`),
    ).toBe(true)
  })

  it("writes nothing when the file is already at the latest version", () => {
    const { db, calls } = recordingDb(SESSION_HISTORY_USER_VERSION)
    applySessionHistorySchema(db)

    // the pre-flight read answers it; no transaction is opened at all
    expect(calls).toEqual(["bare:prepare:PRAGMA user_version"])
  })

  // Before this slice a NEWER file was accepted as-is: `current >= VERSION` returned
  // first, so the `Unsupported` branch was unreachable. Now it is refused.
  it("refuses a file newer than this build instead of accepting it", () => {
    const { db, calls } = recordingDb(SESSION_HISTORY_USER_VERSION + 1)
    expect(() => applySessionHistorySchema(db)).toThrow(SchemaVersionError)
    expect(calls.some((c) => c.includes("exec"))).toBe(false)
  })

  it("commits a complete schema on a real file, and is idempotent", () => {
    const file = scratchDb()
    const db = openSqliteDb(file)
    try {
      applySessionHistorySchema(db)
      applySessionHistorySchema(db)

      const row = db.prepare("PRAGMA user_version").get<{ user_version: number }>()
      expect(row?.user_version).toBe(SESSION_HISTORY_USER_VERSION)
      expect(listSessionTableColumns(db).sort()).toEqual([...SESSION_TABLE_COLUMNS].sort())
    } finally {
      db.close()
    }

    // a second connection sees the whole schema, never a half-built one
    const reader = openSqliteDb(file)
    try {
      const tables = reader
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all<{ name: string }>()
        .map((r) => r.name)
      expect(tables).toEqual([
        "hidden_folders",
        "history_migrations",
        "legacy_folders",
        "session_usage",
        "sessions",
        "usage_cycles",
      ])
    } finally {
      reader.close()
    }
  })
})
