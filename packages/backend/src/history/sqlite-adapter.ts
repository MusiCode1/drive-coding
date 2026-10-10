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

/** Live database held by another connection — retry after release, not corruption. */
export class SqliteBusyError extends Error {
  override readonly name: string = "SqliteBusyError"
  constructor(message: string, cause?: unknown) {
    super(message)
    if (cause !== undefined) this.cause = cause
  }
}

/** Boot/read budget expired before a new retry attempt could start. */
export class SqliteDeadlineError extends SqliteBusyError {
  override readonly name = "SqliteDeadlineError"
  constructor(message = "SQLite busy retry deadline exceeded") {
    super(message)
  }
}

/** Permission, space, or path I/O failure — distinct from corruption/open fallback. */
export class SqliteIoError extends Error {
  override readonly name = "SqliteIoError"
  constructor(message: string, cause?: unknown) {
    super(message)
    if (cause !== undefined) this.cause = cause
  }
}

/** Native spin-wait inside the driver — short sync block only (fix4). */
export const SQLITE_BUSY_TIMEOUT_MS = 50

function errorChain(e: unknown): unknown[] {
  const chain: unknown[] = []
  let cur: unknown = e
  while (cur != null) {
    chain.push(cur)
    if (typeof cur === "object" && cur !== null && "cause" in cur) {
      cur = (cur as { cause: unknown }).cause
    } else {
      break
    }
  }
  return chain
}

const SQLITE_IO_PRIMARY = new Set([8, 10, 13, 14, 23])

const BUN_SQLITE_IO_FAMILIES = [
  "SQLITE_READONLY",
  "SQLITE_IOERR",
  "SQLITE_CANTOPEN",
  "SQLITE_FULL",
  "SQLITE_PERM",
] as const

const FS_IO_ERRCODES = new Set(["EACCES", "EROFS", "ENOSPC", "EPERM", "EIO"])

function sqliteCodeMatchesFamily(code: string, family: string): boolean {
  return code === family || code.startsWith(`${family}_`)
}

function isNodeSqliteBusyRecord(rec: Record<string, unknown>): boolean {
  return (
    rec.code === "ERR_SQLITE_ERROR" &&
    typeof rec.errcode === "number" &&
    (rec.errcode & 0xff) === 5
  )
}

function isBunSqliteIoRecord(rec: Record<string, unknown>): boolean {
  const code = rec.code
  if (typeof code !== "string") return false
  return BUN_SQLITE_IO_FAMILIES.some((family) => sqliteCodeMatchesFamily(code, family))
}

function isNodeSqliteIoRecord(rec: Record<string, unknown>): boolean {
  return (
    rec.code === "ERR_SQLITE_ERROR" &&
    typeof rec.errcode === "number" &&
    SQLITE_IO_PRIMARY.has(rec.errcode & 0xff)
  )
}

function isFsIoRecord(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.errno === "number" &&
    rec.errno < 0 &&
    typeof rec.code === "string" &&
    FS_IO_ERRCODES.has(rec.code)
  )
}

/** Driver or fs-chain I/O — not BUSY, not generic corruption fallback. */
export function isSqliteIoCause(e: unknown): boolean {
  if (e instanceof SqliteIoError) return true
  for (const x of errorChain(e)) {
    if (typeof x !== "object" || x === null) continue
    const rec = x as Record<string, unknown>
    if (isFsIoRecord(rec)) return true
    if (isBunSqliteIoRecord(rec)) return true
    if (isNodeSqliteIoRecord(rec)) return true
  }
  return false
}

/** Driver BUSY only — Bun `SQLITE_BUSY`, Node `ERR_SQLITE_ERROR` + errcode 5 (not bare errno). */
export function isSqliteBusyCause(e: unknown): boolean {
  if (e instanceof SqliteBusyError) return true
  for (const x of errorChain(e)) {
    if (typeof x !== "object" || x === null) continue
    const rec = x as Record<string, unknown>
    if (rec.code === "SQLITE_BUSY") return true
    if (isNodeSqliteBusyRecord(rec)) return true
  }
  return false
}

/** Maps driver errors from health checks — exported for tests (DoD 11). */
export function classifySqliteHealthError(
  e: unknown,
  file: string,
): SqliteOpenError | SqliteBusyError | SqliteIoError {
  if (e instanceof SqliteOpenError || e instanceof SqliteBusyError || e instanceof SqliteIoError) {
    return e
  }
  if (isSqliteBusyCause(e)) {
    return new SqliteBusyError(`Database at ${file} is locked`, e)
  }
  if (isSqliteIoCause(e)) {
    return new SqliteIoError(`Database I/O error at ${file}`, e)
  }
  return new SqliteOpenError(`Database at ${file} is not a valid SQLite file`, e)
}

function rethrowAssertHealthyError(e: unknown, file: string): never {
  if (e instanceof SqliteOpenError || e instanceof SqliteBusyError || e instanceof SqliteIoError) {
    throw e
  }
  throw classifySqliteHealthError(e, file)
}

function rethrowOpenFailure(e: unknown, file: string): never {
  if (isSqliteBusyCause(e)) {
    throw new SqliteBusyError(`Failed to open SQLite database at ${file}`, e)
  }
  if (isSqliteIoCause(e)) {
    throw new SqliteIoError(`Failed to open SQLite database at ${file}`, e)
  }
  throw new SqliteOpenError(`Failed to open SQLite database at ${file}`, e)
}

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
    rethrowOpenFailure(e, file)
  }
}

function assertHealthyDb(raw: RawDb, file: string): void {
  try {
    raw.exec(`PRAGMA busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}`)
    raw.exec(
      `PRAGMA journal_mode=DELETE;
       PRAGMA synchronous=FULL;
       PRAGMA foreign_keys=ON;`,
    )
    const jmStmt = raw.prepare("PRAGMA journal_mode")
    const jm = getRow<{ journal_mode?: string }>(jmStmt, [])
    if (jm?.journal_mode !== "delete") {
      throw new SqliteOpenError(`journal_mode is ${String(jm?.journal_mode)}, expected delete`)
    }
    const fk = getRow<{ foreign_keys?: number }>(raw.prepare("PRAGMA foreign_keys"), [])
    if (fk?.foreign_keys !== 1) {
      throw new SqliteOpenError(`foreign_keys is ${String(fk?.foreign_keys)}, expected 1`)
    }
    const ic = getRow<{ integrity_check?: string }>(raw.prepare("PRAGMA integrity_check"), [])
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
    rethrowAssertHealthyError(e, file)
  }
}

/** Bun returns `null` for a miss; Node returns `undefined`. Contract is always `undefined`. */
function getRow<T>(raw: RawStatement, params: SqlParam[]): T | undefined {
  const row = raw.get(...normalizeParams(params))
  if (row == null) return undefined
  return row as T
}

function wrapStatement(raw: RawStatement): SqliteStatement {
  return {
    run(...params: SqlParam[]) {
      raw.run(...normalizeParams(params))
    },
    get<T>(...params: SqlParam[]) {
      return getRow<T>(raw, params)
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
      let started = false
      try {
        raw.exec("BEGIN IMMEDIATE")
        started = true
        inTransaction = true
        const result = fn()
        raw.exec("COMMIT")
        return result
      } catch (e) {
        if (started) {
          try {
            raw.exec("ROLLBACK")
          } catch {
            // best-effort rollback
          }
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
