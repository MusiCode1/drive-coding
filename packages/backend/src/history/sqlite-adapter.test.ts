/**
 * sqlite-adapter.test.ts — driver normalization, pragmas, transactions, corrupt file.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { openSqliteDb, SqliteOpenError } from "./sqlite-adapter.js"

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

  it("throws SqliteOpenError on corrupt file without truncating source bytes", () => {
    dir = mkdtempSync(join(tmpdir(), "dc-sqlite-corrupt-"))
    dbPath = join(dir, "corrupt.sqlite")
    const garbage = "this is not a database"
    writeFileSync(dbPath, garbage)
    expect(() => openSqliteDb(dbPath)).toThrow(SqliteOpenError)
    expect(() => openSqliteDb(dbPath)).toThrow(/not a valid SQLite|integrity_check|Failed to open/)
    expect(readFileSync(dbPath, "utf8")).toBe(garbage)
  })
})
