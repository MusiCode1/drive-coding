/**
 * http-session-lookup.ts — GET /api/sessions/:cliKind/:sessionId (slice fix-session-url-hijack).
 */

import type { Hono } from "hono"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import { sqliteHistoryHttpErrorResponse, withHistoryReadRetry } from "./http-sqlite-read-retry.js"

export function registerSessionLookupHttp(
  app: Hono,
  deps: { sessionHistoryStore: SessionHistoryStore },
): void {
  app.get("/api/sessions/:cliKind/:sessionId", async (c) => {
    const cliKind = c.req.param("cliKind")
    const sessionId = c.req.param("sessionId")
    try {
      const found = await withHistoryReadRetry(() =>
        deps.sessionHistoryStore.findSession(cliKind, sessionId),
      )
      if (found == null) {
        return c.json({ error: "unknown session", code: "acp_session_not_found" }, 404)
      }
      return c.json(found)
    } catch (e) {
      return sqliteHistoryHttpErrorResponse(c, e)
    }
  })
}
