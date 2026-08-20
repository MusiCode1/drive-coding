/**
 * state.ts — GET /api/agents/:id/state (S4 C5).
 *
 * One-shot snapshot endpoint — returns current SessionState as JSON.
 * Used for debug/health checks (not part of the normal SSE flow).
 *
 * Returns:
 *   - 404 if host not found
 *   - 200 with JSON snapshot of host.state
 *
 * ─── slice session-host-http C5 (TDD) ───
 */

import type { Hono } from "hono"
import type { AgentSessionRegistry } from "../registry.js"

/**
 * registerStateRoute — registers GET /api/agents/:id/state on the Hono app.
 */
export function registerStateRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.get("/api/agents/:id/state", (c) => {
    const agentId = c.req.param("id")

    const host = registry.getHost(agentId)
    if (!host) {
      return c.json({ error: "Agent connection not found" }, 404)
    }

    return c.json(host.state, 200)
  })
}
