/**
 * http-token-usage.ts — GET /api/usage/tokens (slice token-usage-persistence C4).
 */

import type { Hono } from "hono"
import type { TokenUsageStore } from "../usage/token-usage-store.js"

export function registerTokenUsageHttp(app: Hono, deps: { tokenUsageStore: TokenUsageStore }): void {
  app.get("/api/usage/tokens", (c) => {
    const cwd = c.req.query("cwd")
    const limitRaw = c.req.query("limit")
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined
    const records = deps.tokenUsageStore.listRecords({
      ...(cwd !== undefined && cwd !== "" ? { cwd } : {}),
      ...(limit !== undefined && Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    })
    return c.json({ sessions: records })
  })
}
