/**
 * http-session-lookup.ts — GET /api/sessions/:cliKind/:acpSessionId
 *
 * Answers "does this session exist, and where did it run" **without a live host**.
 *
 * ACP `session/list` can only answer it through a running agent, and a running agent
 * needs a `cwd` — the chicken-and-egg that made a link to an existing session fail with
 * `not-found` whenever no host of that CLI happened to be up. The history table knows
 * the `cwd`, so resuming can start from the link alone.
 *
 * 🛑 This store and `session/list` are **two different sources, and neither contains the
 * other**: a session the CLI remembers may have no row here (we never hosted it), and a
 * row here may name a session the CLI has since deleted. A 404 is "no row", never "no
 * such session" — see `docs/agents/20-session-lifecycle.md`.
 */

import type { Hono } from "hono"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import { sqliteHistoryHttpErrorResponse, withHistoryReadRetry } from "./http-sqlite-read-retry.js"

export function registerSessionLookupRoute(app: Hono, store: SessionHistoryStore): void {
  app.get("/api/sessions/:cliKind/:acpSessionId", async (c) => {
    const cliKind = c.req.param("cliKind")
    const acpSessionId = c.req.param("acpSessionId")
    if (!cliKind || !acpSessionId) {
      return c.json({ error: "cliKind and acpSessionId required" }, 400)
    }
    try {
      const row = await withHistoryReadRetry(() => store.getSessionRow(cliKind, acpSessionId))
      if (row === undefined) return c.json({ error: "session not in history" }, 404)
      return c.json({ session: row })
    } catch (e) {
      return sqliteHistoryHttpErrorResponse(c, e)
    }
  })
}
