/**
 * http-usage.ts — HTTP endpoint for TTS usage summary.
 *
 * GET /api/usage/summary → 200 UsageSummary (JSON)
 *
 * Slice: tts-usage-metering
 */

import type { Hono } from "hono"
import type { UsageStore } from "../usage/usage-store.js"

export function registerUsageHttp(app: Hono, deps: { usageStore: UsageStore }): void {
  const { usageStore } = deps

  // GET /api/usage/summary — returns current totals per provider
  app.get("/api/usage/summary", (c) => {
    return c.json(usageStore.summary())
  })
}
