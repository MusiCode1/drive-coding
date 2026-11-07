/**
 * schema-migrations.ts — numbered schema steps for history.sqlite.
 *
 * ─── The version model ───
 *   v0  legacy JSON files only, no database
 *   v1  SQLite with the session-history schema
 *
 * Two kinds of entry share one ledger (`history_migrations`), because they answer two
 * questions that can be true independently — a fresh install is a valid v1 with nothing
 * imported, and `HISTORY_DB_FILE` skips the import by design:
 *   `schema-v<N>`             — shape:  this step ran
 *   `import-legacy-json-v1`   — data:   the JSON was copied in
 *
 * ─── Why a runner at all (measured 2026-10-10) ───
 * `CREATE TABLE IF NOT EXISTS` cannot evolve an existing table. A database carrying an
 * older `sessions` shape at user_version 0 came out of the old code **unchanged and
 * stamped v1**: 8 columns before, 8 after, `SELECT roleLabel` → `no such column`. And
 * since the next boot sees `user_version >= 1` and returns early, that mislabelled state
 * was permanent. Hence: stamp only after a step really ran, and verify the result.
 */

import { createLogger } from "@drive-coding/core/log"
import {
  listSessionTableColumns,
  SESSION_HISTORY_DDL,
  SESSION_TABLE_COLUMNS,
} from "./session-history-schema-ddl.js"
import type { SqliteDb } from "./sqlite-adapter.js"

const log = createLogger("backend.history.schema")

export type SchemaStep = {
  /** user_version this step produces. Steps run in ascending order. */
  to: number
  label: string
  up(db: SqliteDb): void
}

/**
 * The product's steps. Deliberately one entry: v1 is the first shape that ever shipped.
 * Tests inject their own list to exercise multi-step and ALTER paths — a fictional v2
 * has no business living in product code.
 */
export const SCHEMA_STEPS: readonly SchemaStep[] = [
  { to: 1, label: "base-schema", up: (db) => db.exec(SESSION_HISTORY_DDL) },
]

export const SESSION_HISTORY_USER_VERSION = SCHEMA_STEPS[SCHEMA_STEPS.length - 1]?.to ?? 0

/** The file is newer than this build understands. Continuing would be a guess. */
export class SchemaVersionError extends Error {
  override readonly name = "SchemaVersionError"
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `session history database is at user_version ${found}, this build supports up to ` +
        `${supported}. Refusing to touch it — run a newer build, or move the file aside.`,
    )
  }
}

/** The stamp says one thing and the tables say another. Every later query is a gamble. */
export class SchemaDriftError extends Error {
  override readonly name = "SchemaDriftError"
  constructor(
    readonly missing: string[],
    readonly unexpected: string[],
  ) {
    super(
      `session history schema does not match this build — missing [${missing.join(", ")}], ` +
        `unexpected [${unexpected.join(", ")}]. The file was not modified.`,
    )
  }
}

/** Columns the build expects vs. columns the file has. Empty arrays ⇒ no drift. */
export function columnDrift(
  db: SqliteDb,
  expected: readonly string[] = SESSION_TABLE_COLUMNS,
): { missing: string[]; unexpected: string[] } {
  const actual = new Set(listSessionTableColumns(db))
  const want = new Set<string>(expected)
  return {
    missing: [...want].filter((c) => !actual.has(c)),
    unexpected: [...actual].filter((c) => !want.has(c)),
  }
}

export type RunSchemaMigrationsOpts = {
  /** Injected for tests; defaults to the product's steps. */
  steps?: readonly SchemaStep[]
  /** Called before the first mutating step, outside any transaction (VACUUM cannot
   *  run inside one — probed). Receives the version the file is at right now. */
  backup?: (fromVersion: number) => void
  /**
   * Columns `sessions` must have once the run finishes. Defaults to the build's
   * expectation. Tests that inject steps pass their own — the check stays live
   * instead of being switched off, which is the only way it proves anything.
   * `null` disables it, for step lists that do not own `sessions` at all.
   */
  expectedColumns?: readonly string[] | null
}

/**
 * Brings `db` up to the latest step. Each step is one transaction that ends with its
 * ledger row and its version stamp, so the three either all land or none do.
 */
export function runSchemaMigrations(db: SqliteDb, opts?: RunSchemaMigrationsOpts): number {
  const steps = [...(opts?.steps ?? SCHEMA_STEPS)].sort((a, b) => a.to - b.to)
  const latest = steps[steps.length - 1]?.to ?? 0
  const expected =
    opts?.expectedColumns === undefined ? SESSION_TABLE_COLUMNS : opts.expectedColumns

  // Pre-flight read, outside any transaction: only to decide whether a backup is worth
  // taking. VACUUM INTO cannot run inside a transaction (probed), so it has to happen
  // before the lock — and a redundant backup is cheap, a missing one is not.
  const preflight = readVersion(db)
  if (preflight > latest) throw new SchemaVersionError(preflight, latest)
  if (preflight === latest) return preflight
  if (opts?.backup && preflight > 0) opts.backup(preflight)

  // 🛑 The version is read AGAIN here, under BEGIN IMMEDIATE, and it is that read that
  // decides. The pre-flight value is stale by construction: two processes booting
  // together both see it. Splitting the probe from the DDL is exactly the race that was
  // measured at 9 failures in 500 before fix6 — for an idempotent CREATE IF NOT EXISTS
  // the loser is harmless, but a mutating step (ALTER TABLE ADD COLUMN) would fail with
  // `duplicate column name`.
  //
  // One transaction around every step AND the verification: if the shape does not match
  // afterwards, the stamps roll back with it. Otherwise a no-op DDL leaves the file
  // stamped at a version it does not have — the failure this module exists to prevent.
  let applied: SchemaStep[] = []
  let reached = preflight
  db.transaction(() => {
    const current = readVersion(db)
    if (current > latest) throw new SchemaVersionError(current, latest)
    reached = current
    applied = steps.filter((s) => s.to > current)
    for (const step of applied) {
      step.up(db)
      db.prepare(
        "INSERT OR REPLACE INTO history_migrations (migrationId, completedAt) VALUES (?, ?)",
      ).run(`schema-v${step.to}`, Date.now())
      db.exec(`PRAGMA user_version = ${step.to}`)
      reached = step.to
    }
    if (expected !== null) {
      const drift = columnDrift(db, expected)
      if (drift.missing.length > 0 || drift.unexpected.length > 0) {
        throw new SchemaDriftError(drift.missing, drift.unexpected)
      }
    }
  })
  for (const step of applied) {
    log.info({ to: step.to, label: step.label }, "schema migration applied")
  }
  return reached
}

function readVersion(db: SqliteDb): number {
  return db.prepare("PRAGMA user_version").get<{ user_version: number }>()?.user_version ?? 0
}
