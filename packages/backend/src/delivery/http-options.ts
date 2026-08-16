import * as os from "node:os"
import type { Hono } from "hono"

/**
 * getHomeDir: env (HOME/USERPROFILE) קודם, ואז os.homedir() כ-fallback.
 * `||` (לא `??`) — HOME="" ריק נופל ל-fallback ולא מוחזר כמחרוזת ריקה.
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

/**
 * GET /api/options — מחזיר { homeDir } בלבד.
 * homeDir משמש את ה-FE ל-default של שדה cwd (connect page) ול-start של folder-picker.
 * (היסטורי: החזיר גם models+projects — נמחקו 2026-07-10, היו dead payload שחסם את ה-event-loop
 *  דרך execFileSync("opencode models") + readdirSync.)
 */
export function registerHttpOptions(app: Hono): void {
  app.get("/api/options", (c) => c.json({ homeDir: getHomeDir() }))
}
