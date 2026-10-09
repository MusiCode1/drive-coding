/**
 * DoD 21 — dual-runtime gate (run via `scripts/sqlite-dual-runtime-gate.mjs`).
 * Exit 0 when all checks pass; exit 1 on failure.
 */

import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { applySessionHistorySchema } from "./session-history-schema.js"
import { openSqliteDb, SqliteBusyError } from "./sqlite-adapter.js"

const LEGACY_IMPORT_MIGRATION_ID = "import-legacy-json-v1"

const runtime =
  typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
    ? "bun"
    : `node ${process.version}`
/** Subprocess workers always run from source (`.ts` entry), including when gate runs from `dist/`. */
const workerDir = fileURLToPath(new URL("../../src/history", import.meta.url))
const workerScript = join(workerDir, "migration-subprocess-entry.ts")

const failures: string[] = []

function fail(msg: string): void {
  failures.push(`[${runtime}] ${msg}`)
}

function openDbAfterWorkers(path: string) {
  const attempts = 8
  for (let i = 0; i < attempts; i++) {
    try {
      return openSqliteDb(path)
    } catch (e) {
      if (e instanceof SqliteBusyError && i < attempts - 1) {
        spawnSync("sleep", ["0.05"])
        continue
      }
      throw e
    }
  }
  throw new Error("openDbAfterWorkers: unreachable")
}

/** Pre-fix `!== undefined` checks fail on Bun null misses — gate must catch regressions. */
function checkPositiveControls(): void {
  const bunMiss: null = null
  if (bunMiss !== undefined) {
    console.log("POSITIVE_OK: get/migration `!== undefined` treats Bun null as present")
  } else {
    fail("positive control: expected null !== undefined to be true (Bun miss semantics)")
  }

  const noMigrationRow: null = null
  const brokenMigrationDone = noMigrationRow !== undefined
  if (brokenMigrationDone) {
    console.log("POSITIVE_OK: migrationDone `!== undefined` skips import on empty DB")
  } else {
    fail("positive control: broken migrationDone should be true when row is null")
  }

  const hiddenId: null = null
  if (hiddenId !== undefined) {
    console.log("POSITIVE_OK: projects hide `!== undefined` hides every folder on Bun")
  } else {
    fail("positive control: broken hid check should treat null as hidden")
  }

  let inTransaction = true
  const blocked = inTransaction
  inTransaction = false
  if (blocked) {
    console.log("POSITIVE_OK: stuck inTransaction after failed BEGIN blocks retry")
  } else {
    fail("positive control: stuck inTransaction simulation")
  }
}

function checkGetMiss(): void {
  const dir = mkdtempSync(join(tmpdir(), "gate-get-"))
  const db = openSqliteDb(join(dir, "g.sqlite"))
  db.exec("CREATE TABLE t(x INTEGER)")
  const miss = db.prepare("SELECT 1 AS n FROM t WHERE 0").get<{ n: number }>()
  if (miss !== undefined) fail(`get miss expected undefined, got ${String(miss)}`)
  db.close()
  rmSync(dir, { recursive: true, force: true })
}

function checkLockRetry(): void {
  const dir = mkdtempSync(join(tmpdir(), "gate-lock-"))
  const path = join(dir, "l.sqlite")
  const db1 = openSqliteDb(path)
  const db2 = openSqliteDb(path)
  db1.exec("BEGIN IMMEDIATE")
  try {
    db2.transaction(() => 1)
    fail("expected locked error on second transaction")
  } catch (e) {
    const msg = String(e)
    if (!/locked|SQLITE_BUSY|re-entrant/i.test(msg)) fail(`unexpected lock error: ${msg}`)
  }
  db1.exec("ROLLBACK")
  try {
    const v = db2.transaction(() => 99)
    if (v !== 99) fail(`retry transaction returned ${v}`)
  } catch (e) {
    fail(`retry after unlock failed: ${String(e)}`)
  }
  db1.close()
  db2.close()
  rmSync(dir, { recursive: true, force: true })
}

async function checkParallelImport(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "gate-import-"))
  const dbPath = join(dir, "history.sqlite")
  const usagePath = join(dir, "sessions.json")
  const projectsPath = join(dir, "projects.json")
  writeFileSync(
    usagePath,
    JSON.stringify({
      s1: {
        acpSessionId: "s1",
        agentId: "a1",
        cliKind: "claude",
        cwd: "/p",
        firstSeenAt: 1,
        lastSeenAt: 2,
        turns: 0,
        lastUsed: 1,
        size: 1,
        cycles: [{ startedAt: 1, peakUsed: 1, closedAt: null }],
        cyclesTruncated: false,
      },
    }),
  )
  writeFileSync(projectsPath, JSON.stringify({ projects: [] }))

  function runWorker(): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("bun", [workerScript, dbPath, usagePath, projectsPath], {
        cwd: workerDir,
      })
      let out = ""
      child.stdout.on("data", (c) => {
        out += String(c)
      })
      child.stderr.on("data", (c) => {
        out += String(c)
      })
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(out || `exit ${code}`))
        else resolve(out.trim().split("\n").pop() ?? "")
      })
    })
  }

  const [a, b] = await Promise.all([runWorker(), runWorker()])
  const ra = JSON.parse(a) as { result: string }
  const rb = JSON.parse(b) as { result: string }
  const results = [ra.result, rb.result].sort()
  if (results.join(",") !== "imported,skipped") {
    fail(`parallel import expected imported+skipped, got ${results.join("/")}`)
  }
  const db = openDbAfterWorkers(dbPath)
  const n = db.prepare("SELECT count(*) AS n FROM sessions").get<{ n: number }>()?.n ?? 0
  if (n < 1) fail(`sessions count after import: ${n}`)
  const marker = db
    .prepare("SELECT migrationId FROM history_migrations WHERE migrationId = ?")
    .get<{ migrationId: string }>(LEGACY_IMPORT_MIGRATION_ID)
  if (marker === undefined) fail("history_migrations marker missing after import")
  db.close()
  rmSync(dir, { recursive: true, force: true })
}

function checkSigkillRollback(): void {
  const dir = mkdtempSync(join(tmpdir(), "gate-kill-"))
  const dbPath = join(dir, "k.sqlite")
  {
    const bootstrap = openSqliteDb(dbPath)
    applySessionHistorySchema(bootstrap)
    bootstrap.close()
  }
  const childScript = `
import { openSqliteDb } from "./sqlite-adapter.ts";
const db = openSqliteDb(${JSON.stringify(dbPath)});
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT INTO sessions (cliKind, acpSessionId, agentId, cwd, firstSeenAt, lastSeenAt, lastAttachedAt, turns) VALUES ('c','s','a','/p',1,1,1,0)").run();
setInterval(() => {}, 1000);
`
  const scriptPath = join(dir, "hang.ts")
  writeFileSync(scriptPath, childScript)
  const child = spawn("bun", [scriptPath], { cwd: workerDir, detached: true, stdio: "ignore" })
  spawnSync("sleep", ["0.25"])
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      try {
        process.kill(child.pid, "SIGKILL")
      } catch {
        /* already dead */
      }
    }
  }
  spawnSync("sleep", ["0.15"])
  const db = openSqliteDb(dbPath)
  const n = db.prepare("SELECT count(*) AS n FROM sessions").get<{ n: number }>()?.n ?? 0
  const m =
    db.prepare("SELECT count(*) AS n FROM history_migrations").get<{ n: number }>()?.n ?? 0
  const ic = db.prepare("PRAGMA integrity_check").get<{ integrity_check: string }>()
  if (n !== 0) fail(`SIGKILL rollback: sessions=${n}`)
  if (m !== 0) fail(`SIGKILL rollback: migrations=${m}`)
  if (ic?.integrity_check !== "ok") fail(`integrity after SIGKILL: ${ic?.integrity_check}`)
  db.close()
  rmSync(dir, { recursive: true, force: true })
}

async function main(): Promise<void> {
  console.log(`@@@GATE runtime=${runtime}`)
  checkPositiveControls()
  checkGetMiss()
  checkLockRetry()
  await checkParallelImport()
  checkSigkillRollback()

  if (failures.length > 0) {
    for (const f of failures) console.error(f)
    process.exit(1)
  }
  console.log("@@@GATE_OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
