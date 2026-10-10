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
  it("runs the probe, the DDL and the version bump inside one transaction", () => {
    const { db, calls } = recordingDb(0)
    applySessionHistorySchema(db)

    expect(calls[0]).toBe("begin")
    expect(calls.at(-1)).toBe("commit")
    // nothing may touch the file outside the transaction
    expect(calls.filter((c) => c.startsWith("bare:"))).toEqual([])
    // and both writes are in there
    expect(calls.some((c) => c.startsWith("tx:exec:CREATE TABLE"))).toBe(true)
    expect(
      calls.some((c) => c === `tx:exec:PRAGMA user_version = ${SESSION_HISTORY_USER_VERSION}`),
    ).toBe(true)
    expect(calls.filter((c) => c === "begin")).toHaveLength(1)
  })

  it("probes inside the transaction and writes nothing when already current", () => {
    const { db, calls } = recordingDb(SESSION_HISTORY_USER_VERSION)
    applySessionHistorySchema(db)

    expect(calls).toEqual(["begin", "tx:prepare:PRAGMA user_version", "commit"])
  })

  // The `Unsupported … user_version` throw is unreachable while
  // SESSION_HISTORY_USER_VERSION === 1: the `current >= VERSION` guard returns
  // first, so a NEWER file is accepted as-is. This pins what actually happens.
  it("treats a newer user_version as current and writes nothing", () => {
    const { db, calls } = recordingDb(SESSION_HISTORY_USER_VERSION + 1)
    applySessionHistorySchema(db)
    expect(calls).toEqual(["begin", "tx:prepare:PRAGMA user_version", "commit"])
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
