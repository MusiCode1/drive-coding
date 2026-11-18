/**
 * http-token-usage.ts — GET /api/usage/tokens (slice token-usage-persistence C4).
 */

import type { Hono } from "hono"
import type { TokenUsageStore } from "../usage/token-usage-store.js"
import { sqliteHistoryHttpErrorResponse, withHistoryReadRetry } from "./http-sqlite-read-retry.js"

export function registerTokenUsageHttp(
  app: Hono,
  deps: { tokenUsageStore: TokenUsageStore },
): void {
  app.get("/api/usage/tokens", async (c) => {
    const cwd = c.req.query("cwd")
    const limitRaw = c.req.query("limit")
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined
    try {
      const records = await withHistoryReadRetry(() =>
        deps.tokenUsageStore.listRecords({
          ...(cwd !== undefined && cwd !== "" ? { cwd } : {}),
          ...(limit !== undefined && Number.isFinite(limit) && limit > 0 ? { limit } : {}),
        }),
      )
      return c.json({ sessions: records })
    } catch (e) {
      return sqliteHistoryHttpErrorResponse(c, e)
    }
  })
}
