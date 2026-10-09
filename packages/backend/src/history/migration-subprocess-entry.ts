/**
 * Subprocess entry for parallel import tests (two real processes, one DB file).
 * Usage: bun migration-subprocess-entry.ts <dbPath> <usageJson> <projectsJson>
 */

import { applySessionHistorySchema } from "./session-history-schema.js"
import { runLegacyImport } from "./session-history-migration.js"
import { openSqliteDb } from "./sqlite-adapter.js"

const [dbPath, usageJson, projectsJson] = process.argv.slice(2)
if (!dbPath) {
  console.error("missing dbPath")
  process.exit(2)
}

const db = openSqliteDb(dbPath)
applySessionHistorySchema(db)
const result = runLegacyImport({
  db,
  legacySources: {
    usageJsonPath: usageJson || undefined,
    projectsJsonPath: projectsJson || undefined,
  },
})
const ic = db.prepare("PRAGMA integrity_check").get<{ integrity_check: string }>()
console.log(JSON.stringify({ result, integrity: ic?.integrity_check }))
db.close()
