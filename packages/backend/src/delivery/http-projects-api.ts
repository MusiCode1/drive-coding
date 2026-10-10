import type { Context, Hono } from "hono"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import {
  sqliteHistoryHttpErrorResponse,
  withHistoryReadRetry,
} from "./http-sqlite-read-retry.js"

/** Maps hideFolder failures to HTTP status (503 busy · 500 I/O · 500 corruption/open). */
export function hideFolderHttpErrorResponse(c: Context, e: unknown): Response {
  return sqliteHistoryHttpErrorResponse(c, e)
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

export function registerProjectsListRoute(app: Hono, store: SessionHistoryStore): void {
  app.get("/api/projects", async (c) => {
    try {
      const projects = await withHistoryReadRetry(() => listProjectsForApi(store))
      return c.json({ projects })
    } catch (e) {
      return sqliteHistoryHttpErrorResponse(c, e)
    }
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
