/**
 * http-cli-usage.ts — GET /api/usage/clis (slice usage-per-cli).
 */

import type { Hono } from "hono"
import type { ProjectEntry } from "../app/project-entry.js"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import { aggregateCliUsage } from "../usage/aggregate-cli-usage.js"
import { sqliteHistoryHttpErrorResponse, withHistoryReadRetry } from "./http-sqlite-read-retry.js"

function toProjectEntries(rows: ReturnType<SessionHistoryStore["listProjects"]>): ProjectEntry[] {
  return rows.map((p) => ({
    cwd: p.cwd,
    kind: p.kind as ProjectEntry["kind"],
    lastSeen: p.lastSeen,
    ...(p.lastSessionId !== undefined ? { lastSessionId: p.lastSessionId } : {}),
  }))
}

export function registerCliUsageHttp(
  app: Hono,
  deps: { sessionHistoryStore: SessionHistoryStore },
): void {
  app.get("/api/usage/clis", async (c) => {
    const cwdRaw = c.req.query("cwd")
    const cwd = cwdRaw !== undefined && cwdRaw !== "" ? cwdRaw : undefined
    try {
      const { projects, sessionRows } = await withHistoryReadRetry(() => ({
        projects: deps.sessionHistoryStore.listProjects({ includeHidden: true }),
        sessionRows: deps.sessionHistoryStore.listCliSessionRows(cwd !== undefined ? { cwd } : {}),
      }))
      return c.json({
        clis: aggregateCliUsage(
          sessionRows,
          toProjectEntries(projects),
          cwd !== undefined ? { cwd } : {},
        ),
      })
    } catch (e) {
      return sqliteHistoryHttpErrorResponse(c, e)
    }
  })
}
