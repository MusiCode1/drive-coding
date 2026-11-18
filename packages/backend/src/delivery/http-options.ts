import * as os from "node:os"
import type { Hono } from "hono"

/** Home directory for FE cwd defaults — os.homedir() only (boot-layer C5). */
export function getHomeDir(): string {
  return os.homedir()
}

/**
 * GET /api/options — returns { homeDir } only.
 */
export function registerHttpOptions(app: Hono): void {
  app.get("/api/options", (c) => c.json({ homeDir: getHomeDir() }))
}
