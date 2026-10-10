/**
 * sqlite-adapter.test.ts — driver normalization, pragmas, transactions, corrupt file.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  classifySqliteHealthError,
  isSqliteBusyCause,
  openSqliteDb,
  SqliteBusyError,
  SqliteDeadlineError,
  SqliteOpenError,
} from "./sqlite-adapter.js"

describe("openSqliteDb", () => {
  let dir: string
  let dbPath: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function openFresh() {
    dir = mkdtempSync(join(tmpdir(), "dc-sqlite-adapter-"))
    dbPath = join(dir, "test.sqlite")
    const db = openSqliteDb(dbPath)
    db.exec("CREATE TABLE t(a TEXT, b INTEGER, c INTEGER)")
    return db
  }

  it("binds boolean as 0/1", () => {
    const db = openFresh()
    const ins = db.prepare("INSERT INTO t(a,b,c) VALUES(?,?,?)")
    ins.run("bool-f", false, 0)
    ins.run("bool-t", true, 1)
    const rows = db.prepare("SELECT a, b FROM t ORDER BY a").all<{ a: string; b: number }>()
    expect(rows).toEqual([
      { a: "bool-f", b: 0 },
      { a: "bool-t", b: 1 },
    ])
    db.close()
  })

  it("binds undefined as NULL", () => {
    const db = openFresh()
    db.prepare("INSERT INTO t(a,b,c) VALUES(?,?,?)").run("undef", undefined, 2)
    const row = db.prepare("SELECT b FROM t WHERE a='undef'").get<{ b: null | number }>()
    expect(row?.b).toBeNull()
    db.close()
  })

  it("rolls back transaction on throw", () => {
    const db = openFresh()
    db.prepare("INSERT INTO t(a,b,c) VALUES(?,?,?)").run("seed", 1, 1)
    expect(() =>
      db.transaction(() => {
        db.prepare("INSERT INTO t(a,b,c) VALUES(?,?,?)").run("tx", 2, 2)
        throw new Error("abort")
      }),
    ).toThrow("abort")
    const n = db.prepare("SELECT count(*) AS n FROM t").get<{ n: number }>()?.n
    expect(n).toBe(1)
    db.close()
  })

  it("rejects re-entrant transaction", () => {
    const db = openFresh()
    expect(() =>
      db.transaction(() => {
        db.transaction(() => {})
      }),
    ).toThrow(/re-entrant/)
    db.close()
  })

  it("uses journal_mode=delete and foreign_keys=ON", () => {
    const db = openFresh()
    const jm = db.prepare("PRAGMA journal_mode").get<{ journal_mode: string }>()
    expect(jm?.journal_mode).toBe("delete")
    const fk = db.prepare("PRAGMA foreign_keys").get<{ foreign_keys: number }>()
    expect(fk?.foreign_keys).toBe(1)
    db.close()
  })

  it("get() on zero rows returns undefined (not null)", () => {
    const db = openFresh()
    const miss = db.prepare("SELECT 1 AS n WHERE 0").get<{ n: number }>()
    expect(miss).toBeUndefined()
    db.close()
  })

  it("transaction succeeds after a failed BEGIN once the lock is released", () => {
    dir = mkdtempSync(join(tmpdir(), "dc-sqlite-lock-"))
    dbPath = join(dir, "lock.sqlite")
    const db1 = openSqliteDb(dbPath)
    const db2 = openSqliteDb(dbPath)
    db1.exec("BEGIN IMMEDIATE")
    expect(() => db2.transaction(() => 1)).toThrow(/locked|SQLITE_BUSY|re-entrant/i)
    db1.exec("ROLLBACK")
    expect(db2.transaction(() => 42)).toBe(42)
    db1.close()
    db2.close()
  })

  describe("classifySqliteHealthError — busy vs EIO vs corrupt (DoD 11)", () => {
    it("1. Bun SQLITE_BUSY driver shape ⇒ SqliteBusyError", () => {
      const busy = { code: "SQLITE_BUSY", message: "database is locked" }
      expect(isSqliteBusyCause(busy)).toBe(true)
      const err = classifySqliteHealthError(busy, "/tmp/x.sqlite")
      expect(err).toBeInstanceOf(SqliteBusyError)
      expect(err.message).toMatch(/locked/)
      expect(err.message).not.toMatch(/not a valid SQLite file/)
    })

    it("2. EIO shape (synthetic — not measured real disk I/O failure) ⇒ not SqliteBusyError", () => {
      const eio = { errno: 5, code: "EIO", message: "EIO: i/o error" }
      expect(isSqliteBusyCause(eio)).toBe(false)
      const err = classifySqliteHealthError(eio, "/tmp/x.sqlite")
      expect(err).not.toBeInstanceOf(SqliteBusyError)
      expect(err).toBeInstanceOf(SqliteOpenError)
      expect(err.message).toMatch(/not a valid SQLite file/)
    })

    it("regression: errno 5 without SQLITE_BUSY code is not classified as busy", () => {
      expect(isSqliteBusyCause({ errno: 5, code: "EIO" })).toBe(false)
    })

    it("Node ERR_SQLITE_ERROR errcode 5 ⇒ busy (not bare errno)", () => {
      const nodeBusy = { code: "ERR_SQLITE_ERROR", errcode: 5, message: "database is locked" }
      expect(isSqliteBusyCause(nodeBusy)).toBe(true)
      expect(classifySqliteHealthError(nodeBusy, "/tmp/x.sqlite")).toBeInstanceOf(SqliteBusyError)
    })

    it("real EXCLUSIVE lock ⇒ SqliteBusyError via product classifiers", () => {
      dir = mkdtempSync(join(tmpdir(), "dc-sqlite-real-busy-"))
      dbPath = join(dir, "real-busy.sqlite")
      const db1 = openSqliteDb(dbPath)
      const db2 = openSqliteDb(dbPath)
      db1.exec("BEGIN EXCLUSIVE")
      let caught: unknown
      try {
        db2.transaction(() => 1)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeDefined()
      expect(isSqliteBusyCause(caught)).toBe(true)
      expect(classifySqliteHealthError(caught, dbPath)).toBeInstanceOf(SqliteBusyError)
      db1.exec("ROLLBACK")
      db1.close()
      db2.close()
    })

    it("preserves SqliteDeadlineError identity through classify", () => {
      const deadline = new SqliteDeadlineError("boot budget exhausted")
      const out = classifySqliteHealthError(deadline, "/tmp/x.sqlite")
      expect(out).toBe(deadline)
      expect(out.name).toBe("SqliteDeadlineError")
    })

    it("3. non-SQLite file ⇒ SqliteOpenError without truncating bytes", () => {
      dir = mkdtempSync(join(tmpdir(), "dc-sqlite-corrupt-"))
      dbPath = join(dir, "corrupt.sqlite")
      const garbage = "this is not a database"
      writeFileSync(dbPath, garbage)
      expect(() => openSqliteDb(dbPath)).toThrow(SqliteOpenError)
      expect(() => openSqliteDb(dbPath)).toThrow(
        /not a valid SQLite|integrity_check|Failed to open/,
      )
      expect(readFileSync(dbPath, "utf8")).toBe(garbage)
    })
  })
})
