/**
 * Subprocess entry for parallel import tests (two real processes, one DB file).
 * Usage: bun migration-subprocess-entry.ts <dbPath> <usageJson> <projectsJson>
 */

import { BOOT_DB_BUDGET_MS, bootDeadlineFromNow, runLegacyImportWithRetry } from "../boot/sqlite-bootstrap.js"

const argv = process.argv.slice(2)
const dbPathArg = argv[0]
if (!dbPathArg) {
  console.error("missing dbPath")
  process.exit(2)
}
const dbPath: string = dbPathArg
const usageJson = argv[1]
const projectsJson = argv[2]

async function main(): Promise<void> {
  const deadlineAt = bootDeadlineFromNow(BOOT_DB_BUDGET_MS)
  const result = await runLegacyImportWithRetry(
    dbPath,
    {
      usageJsonPath: usageJson || undefined,
      projectsJsonPath: projectsJson || undefined,
    },
    deadlineAt,
  )
  const { openSqliteDb } = await import("./sqlite-adapter.js")
  const db = openSqliteDb(dbPath)
  const ic = db.prepare("PRAGMA integrity_check").get<{ integrity_check: string }>()
  console.log(JSON.stringify({ result, integrity: ic?.integrity_check }))
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
