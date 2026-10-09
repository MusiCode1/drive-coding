/**
 * sqlite-adapter.ts — thin wrapper over node:sqlite / bun:sqlite with param normalization
 * and manual transactions (Node has no db.transaction()).
 */

import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

export type SqlParam = string | number | null | boolean | undefined

export type SqliteStatement = {
  run(...params: SqlParam[]): void
  get<T>(...params: SqlParam[]): T | undefined
  all<T>(...params: SqlParam[]): T[]
}

export type SqliteDb = {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  /** BEGIN IMMEDIATE → fn → COMMIT; any throw ⇒ ROLLBACK and rethrow. Not re-entrant. */
  transaction<T>(fn: () => T): T
  close(): void
}

export class SqliteOpenError extends Error {
  override readonly name = "SqliteOpenError"
  constructor(message: string, cause?: unknown) {
    super(message)
    if (cause !== undefined) this.cause = cause
  }
}

const BUSY_TIMEOUT_MS = 2000

function normalizeParam(p: SqlParam): string | number | null {
  if (p === undefined) return null
  if (typeof p === "boolean") return p ? 1 : 0
  return p
}

function normalizeParams(params: SqlParam[]): (string | number | null)[] {
  return params.map(normalizeParam)
}

type RawStatement = {
  run(...params: (string | number | null)[]): void
  get(...params: (string | number | null)[]): unknown
  all(...params: (string | number | null)[]): unknown[]
}

type RawDb = {
  exec(sql: string): void
  prepare(sql: string): RawStatement
  close(): void
}

const isBunRuntime = typeof Bun !== "undefined"
const sqliteDriver = isBunRuntime ? await import("bun:sqlite") : await import("node:sqlite")

function loadRawDb(file: string): RawDb {
  try {
    if (isBunRuntime) {
      const Database = (sqliteDriver as typeof import("bun:sqlite")).Database
      return new Database(file) as RawDb
    }
    const DatabaseSync = (sqliteDriver as typeof import("node:sqlite")).DatabaseSync
    return new DatabaseSync(file) as RawDb
  } catch (e) {
    throw new SqliteOpenError(`Failed to open SQLite database at ${file}`, e)
  }
}

function assertHealthyDb(raw: RawDb, file: string): void {
  try {
    raw.exec(
      `PRAGMA journal_mode=DELETE;
       PRAGMA synchronous=FULL;
       PRAGMA foreign_keys=ON;
       PRAGMA busy_timeout=${BUSY_TIMEOUT_MS};`,
    )
    const jm = raw.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined
    if (jm?.journal_mode !== "delete") {
      throw new SqliteOpenError(`journal_mode is ${String(jm?.journal_mode)}, expected delete`)
    }
    const fk = raw.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number } | undefined
    if (fk?.foreign_keys !== 1) {
      throw new SqliteOpenError(`foreign_keys is ${String(fk?.foreign_keys)}, expected 1`)
    }
    const ic = raw.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined
    if (ic?.integrity_check !== "ok") {
      throw new SqliteOpenError(
        `integrity_check failed for ${file}: ${String(ic?.integrity_check ?? "unknown")}`,
      )
    }
  } catch (e) {
    try {
      raw.close()
    } catch {
      // ignore
    }
    if (e instanceof SqliteOpenError) throw e
    throw new SqliteOpenError(`Database at ${file} is not a valid SQLite file`, e)
  }
}

function wrapStatement(raw: RawStatement): SqliteStatement {
  return {
    run(...params: SqlParam[]) {
      raw.run(...normalizeParams(params))
    },
    get<T>(...params: SqlParam[]) {
      return raw.get(...normalizeParams(params)) as T | undefined
    },
    all<T>(...params: SqlParam[]) {
      return raw.all(...normalizeParams(params)) as T[]
    },
  }
}

export function openSqliteDb(file: string): SqliteDb {
  mkdirSync(dirname(file), { recursive: true })
  const raw = loadRawDb(file)
  assertHealthyDb(raw, file)

  let inTransaction = false

  return {
    exec(sql: string) {
      raw.exec(sql)
    },
    prepare(sql: string) {
      return wrapStatement(raw.prepare(sql))
    },
    transaction<T>(fn: () => T): T {
      if (inTransaction) {
        throw new Error("SqliteDb.transaction is not re-entrant")
      }
      inTransaction = true
      raw.exec("BEGIN IMMEDIATE")
      try {
        const result = fn()
        raw.exec("COMMIT")
        return result
      } catch (e) {
        try {
          raw.exec("ROLLBACK")
        } catch {
          // best-effort rollback
        }
        throw e
      } finally {
        inTransaction = false
      }
    },
    close() {
      raw.close()
    },
  }
}
