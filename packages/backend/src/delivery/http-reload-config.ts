/**
 * http-reload-config.ts — manual reload endpoint (slice cli-specs-hot-reload, Commit 1).
 *
 * POST /api/reload-config → 200 { ok: true }
 *
 * Calls invalidateCache() only. invalidateCache() already emits to onConfigChange
 * listeners (server.ts registered broadcastConfigChanged there), so a second broadcast
 * here would double-send. The emit is the single broadcast path.
 */

import { invalidateCache } from "@drive-coding/provider/config"
import type { Hono } from "hono"

export function registerReloadConfigHttp(app: Hono): void {
  app.post("/api/reload-config", (c) => {
    invalidateCache()
    return c.json({ ok: true })
  })
}
