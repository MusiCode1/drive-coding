import type { Context, Hono } from "hono"
import {
  classifySqliteHealthError,
  SqliteBusyError,
  SqliteIoError,
  SqliteOpenError,
} from "../history/sqlite-adapter.js"
import type { SessionHistoryStore } from "../history/session-history-store.js"

/** Maps hideFolder failures to HTTP status (503 busy · 500 I/O/open · 500 generic). */
export function hideFolderHttpErrorResponse(c: Context, e: unknown): Response {
  if (e instanceof SqliteBusyError) {
    return c.json({ error: "database_locked", code: "SQLITE_BUSY" }, 503)
  }
  if (e instanceof SqliteIoError) {
    return c.json({ error: "history_write_failed", code: "HISTORY_WRITE" }, 500)
  }
  if (e instanceof SqliteOpenError) {
    return c.json({ error: "database_unavailable", code: "SQLITE_OPEN" }, 500)
  }
  const classified = classifySqliteHealthError(e, "history")
  if (classified instanceof SqliteBusyError) {
    return c.json({ error: "database_locked", code: "SQLITE_BUSY" }, 503)
  }
  if (classified instanceof SqliteIoError) {
    return c.json({ error: "history_write_failed", code: "HISTORY_WRITE" }, 500)
  }
  return c.json({ error: "database_unavailable", code: "SQLITE_OPEN" }, 500)
}

export function registerProjectDeleteRoute(app: Hono, store: SessionHistoryStore): void {
  app.delete("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cwd?: unknown }
    const cwd = typeof body.cwd === "string" ? body.cwd : ""
    if (!cwd) return c.json({ error: "cwd required" }, 400)
    try {
      await store.hideFolder(cwd)
    } catch (e) {
      return hideFolderHttpErrorResponse(c, e)
    }
    return c.body(null, 204)
  })
}

export function listProjectsForApi(store: SessionHistoryStore) {
  return store.listProjects().map((p) => ({
    cwd: p.cwd,
    kind: p.kind,
    lastSeen: p.lastSeen,
    ...(p.lastSessionId !== undefined ? { lastSessionId: p.lastSessionId } : {}),
    sessionCount: p.sessionCount,
  }))
}
