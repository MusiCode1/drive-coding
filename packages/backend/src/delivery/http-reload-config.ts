/**
 * http-reload-config.ts — manual reload endpoint (slice cli-specs-hot-reload, Commit 1).
 *
 * POST /api/reload-config → 200 { ok: true }
 *
 * Calls invalidateCache() only. invalidateCache() already emits to onConfigChange
 * listeners (server.ts registered the reload+broadcast handler there), so doing
 * the reload here too would run it twice. The emit is the single path — both for
 * the broadcast and, since the hot-reload extension, for re-resolving
 * config.jsonc and applying what is safe to apply while running.
 */

import { invalidateCache } from "@drive-coding/provider/config"
import type { Hono } from "hono"

export function registerReloadConfigHttp(app: Hono): void {
  app.post("/api/reload-config", (c) => {
    invalidateCache()
    return c.json({ ok: true })
  })
}
