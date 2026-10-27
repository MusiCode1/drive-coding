/**
 * session-history-migration.ts — one-shot import from legacy JSON into history.sqlite.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ensureStateSubdir } from "../paths.js"
import type { TokenUsageRecord } from "../usage/token-usage-store.js"
import {
  type LegacyImportStats,
  noteReason,
  validateLegacyProjectEntry,
  validateLegacyUsageRecord,
} from "./legacy-record-schema.js"
import { insertLegacyFolder } from "./session-history-projects.js"
import type { SqliteDb } from "./sqlite-adapter.js"

export const LEGACY_IMPORT_MIGRATION_ID = "import-legacy-json-v1"

export type LegacySources = {
  usageJsonPath?: string
  projectsJsonPath?: string
}

/** Legacy JSON filenames live only in this module (boot import discovers via here). */
export function discoverLegacyJsonSources(): LegacySources {
  const usagePath = join(ensureStateSubdir("token-usage"), "sessions.json")
  const projectsPath = join(ensureStateSubdir("cache"), "projects-registry.json")
  return {
    usageJsonPath: existsSync(usagePath) ? usagePath : undefined,
    projectsJsonPath: existsSync(projectsPath) ? projectsPath : undefined,
  }
}

export class LegacyImportError extends Error {
  override readonly name = "LegacyImportError"
  constructor(message: string, cause?: unknown) {
    super(message)
    if (cause !== undefined) this.cause = cause
  }
}

type ProjectEntry = {
  cwd: string
  kind: string
  lastSeen: string
  lastSessionId?: string
}

function migrationDone(db: SqliteDb): boolean {
  const row = db
    .prepare("SELECT 1 FROM history_migrations WHERE migrationId = ?")
    .get(LEGACY_IMPORT_MIGRATION_ID)
  return row != null
}

function readJson(path: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (e) {
    throw new LegacyImportError(`Cannot read legacy file ${path}`, e)
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (e) {
    throw new LegacyImportError(`Corrupt legacy JSON at ${path}`, e)
  }
}

function loadUsageRecords(path: string | undefined, stats?: LegacyImportStats): TokenUsageRecord[] {
  if (path === undefined) return []
  const data = readJson(path)
  if (typeof data !== "object" || data === null) {
    throw new LegacyImportError(`Unexpected usage JSON shape at ${path}`)
  }
  const out: TokenUsageRecord[] = []
  // A bad record is skipped, never thrown: an unvalidated one reached the INSERT and
  // raised NOT NULL, which propagates out of prepareBoot() and stops the backend from
  // starting — permanently, because the marker is written in the transaction that failed.
  for (const v of Object.values(data as Record<string, unknown>)) {
    const checked = validateLegacyUsageRecord(v)
    if (!checked.ok) {
      if (stats) stats.usageSkipped++
      noteReason(stats, checked.reason)
      continue
    }
    if (stats) stats.fieldsDropped += checked.droppedFields.length
    for (const f of checked.droppedFields) noteReason(stats, `dropped field ${f}`)
    out.push(checked.value)
  }
  return out
}

function loadProjects(path: string | undefined, stats?: LegacyImportStats): ProjectEntry[] {
  if (path === undefined) return []
  const data = readJson(path)
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { projects?: unknown }).projects)
  ) {
    throw new LegacyImportError(`Unexpected projects registry shape at ${path}`)
  }
  const out: ProjectEntry[] = []
  for (const v of (data as { projects: unknown[] }).projects) {
    const checked = validateLegacyProjectEntry(v)
    if (!checked.ok) {
      if (stats) stats.projectsSkipped++
      noteReason(stats, checked.reason)
      continue
    }
    if (stats) stats.fieldsDropped += checked.droppedFields.length
    out.push(checked.value as ProjectEntry)
  }
  return out
}

function importUsageRecord(db: SqliteDb, rec: TokenUsageRecord): void {
  const lastAttachedAt = rec.lastSeenAt
  db.prepare(
    `INSERT INTO sessions (
      cliKind, acpSessionId, agentId, cwd,
      firstSeenAt, lastSeenAt, lastAttachedAt, turns
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cliKind, acpSessionId) DO UPDATE SET
      agentId = excluded.agentId,
      cwd = excluded.cwd,
      lastSeenAt = excluded.lastSeenAt,
      lastAttachedAt = sessions.lastAttachedAt,
      firstSeenAt = sessions.firstSeenAt,
      turns = excluded.turns`,
  ).run(
    rec.cliKind,
    rec.acpSessionId,
    rec.agentId,
    rec.cwd,
    rec.firstSeenAt,
    rec.lastSeenAt,
    lastAttachedAt,
    rec.turns,
  )

  db.prepare(
    `INSERT INTO session_usage (
      cliKind, acpSessionId, lastUsed, size, cyclesTruncated, costAmount, costCurrency
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cliKind, acpSessionId) DO UPDATE SET
      lastUsed = excluded.lastUsed,
      size = excluded.size,
      cyclesTruncated = excluded.cyclesTruncated,
      costAmount = excluded.costAmount,
      costCurrency = excluded.costCurrency`,
  ).run(
    rec.cliKind,
    rec.acpSessionId,
    rec.lastUsed,
    rec.size,
    rec.cyclesTruncated ? 1 : 0,
    rec.costAmount ?? null,
    rec.costCurrency ?? null,
  )

  db.prepare("DELETE FROM usage_cycles WHERE cliKind = ? AND acpSessionId = ?").run(
    rec.cliKind,
    rec.acpSessionId,
  )
  const ins = db.prepare(
    `INSERT INTO usage_cycles (cliKind, acpSessionId, cycleIndex, startedAt, peakUsed, closedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  rec.cycles.forEach((c, i) => {
    ins.run(rec.cliKind, rec.acpSessionId, i, c.startedAt, c.peakUsed, c.closedAt)
  })
}

function importProjects(
  db: SqliteDb,
  projects: ProjectEntry[],
  knownCwds: Set<string>,
  projectsFileLoaded: boolean,
  stats?: LegacyImportStats,
): void {
  /** An unreadable `lastSeen` falls back to "now" — a wrong timestamp, not an error.
   *  Counting it is the difference between a known approximation and a silent lie. */
  const seenAt = (raw: string): number => {
    const ms = Date.parse(raw)
    if (Number.isFinite(ms)) return ms
    if (stats) stats.unparsedLastSeen++
    noteReason(stats, "lastSeen unparseable")
    return Date.now()
  }
  const registryCwds = new Set(projects.map((p) => p.cwd))
  for (const p of projects) {
    if (p.lastSessionId !== undefined && p.lastSessionId !== "") {
      const lastSeenAt = seenAt(p.lastSeen)
      db.prepare(
        `INSERT INTO sessions (
          cliKind, acpSessionId, agentId, cwd,
          firstSeenAt, lastSeenAt, lastAttachedAt, turns
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(cliKind, acpSessionId) DO UPDATE SET
          cwd = excluded.cwd,
          lastAttachedAt = CASE
            WHEN excluded.lastAttachedAt > sessions.lastAttachedAt THEN excluded.lastAttachedAt
            ELSE sessions.lastAttachedAt END`,
      ).run(p.kind, p.lastSessionId, "legacy-import", p.cwd, lastSeenAt, lastSeenAt, lastSeenAt)
    } else {
      insertLegacyFolder(db, {
        cwd: p.cwd,
        cliKind: p.kind,
        lastSeenAt: seenAt(p.lastSeen),
        payload: JSON.stringify(p),
      })
    }
  }

  if (projectsFileLoaded) {
    for (const cwd of knownCwds) {
      if (!registryCwds.has(cwd)) {
        db.prepare("INSERT OR IGNORE INTO hidden_folders (cwd, hiddenAt) VALUES (?, ?)").run(
          cwd,
          Date.now(),
        )
      }
    }
  }
}

export type LegacyImportResult = "imported" | "skipped" | "no_sources"

export function runLegacyImport(opts: {
  db: SqliteDb
  legacySources: LegacySources
  /** Optional out-param. `LegacyImportResult` stays a plain string on purpose —
   *  checkParallelImport in sqlite-dual-runtime-gate asserts the pair
   *  "imported,skipped", so widening the return type would break that gate. */
  stats?: LegacyImportStats
}): LegacyImportResult {
  if (migrationDone(opts.db)) return "skipped"

  const hasUsage = opts.legacySources.usageJsonPath !== undefined
  const hasProjects = opts.legacySources.projectsJsonPath !== undefined
  if (!hasUsage && !hasProjects) return "no_sources"

  let wroteMarker = false
  opts.db.transaction(() => {
    if (migrationDone(opts.db)) return

    const usage = loadUsageRecords(opts.legacySources.usageJsonPath, opts.stats)
    const projectsFileLoaded = opts.legacySources.projectsJsonPath !== undefined
    const projects = loadProjects(opts.legacySources.projectsJsonPath, opts.stats)
    const cwds = new Set(usage.map((r) => r.cwd))

    for (const rec of usage) {
      importUsageRecord(opts.db, rec)
    }
    importProjects(opts.db, projects, cwds, projectsFileLoaded, opts.stats)

    opts.db
      .prepare("INSERT INTO history_migrations (migrationId, completedAt) VALUES (?, ?)")
      .run(LEGACY_IMPORT_MIGRATION_ID, Date.now())
    wroteMarker = true
  })

  return wroteMarker ? "imported" : "skipped"
}

export function vacuumIntoBackup(db: SqliteDb, backupPath: string): void {
  const escaped = backupPath.replaceAll("'", "''")
  db.exec(`VACUUM INTO '${escaped}'`)
}
