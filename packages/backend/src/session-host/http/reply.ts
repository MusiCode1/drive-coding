/**
 * reply.ts — POST /api/agents/:id/reply (S4 C4).
 *
 * Responds to pending agent requests (permission / elicitation).
 *
 * Body: { kind: "permission" | "elicitation", requestId: number, result: unknown }
 *
 * Kind discriminator is required because permissionSeq and elicitationSeq
 * both start at 0 — requestId alone is not unique across both types.
 *
 * Returns:
 *   - 404 if host not found (not an active connection)
 *   - 200 OK on success — silent no-op if requestId not found
 *     (respondPermission / respondElicitation return void)
 *
 * ─── slice session-host-http C4 (TDD) ───
 */

import type { Hono } from "hono"
import type { AgentSessionRegistry } from "../registry.js"

/**
 * registerReplyRoute — registers POST /api/agents/:id/reply on the Hono app.
 */
export function registerReplyRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.post("/api/agents/:id/reply", async (c) => {
    const agentId = c.req.param("id")

    // Look up existing host (does NOT create — reply requires an active host)
    const host = registry.getHost(agentId)
    if (!host) {
      return c.json({ error: "Agent connection not found" }, 404)
    }

    // Parse body
    const body = await c.req.json() as Record<string, unknown>
    const kind = body.kind as "permission" | "elicitation"
    const requestId = body.requestId as number
    const result = body.result

    // Dispatch by kind
    if (kind === "permission") {
      host.respondPermission(
        requestId,
        result as Parameters<typeof host.respondPermission>[1],
      )
    } else if (kind === "elicitation") {
      host.respondElicitation(
        requestId,
        result as Parameters<typeof host.respondElicitation>[1],
      )
    } else {
      return c.json({ error: `Unknown kind: ${String(body.kind)}` }, 400)
    }

    // 200 OK — silent no-op if requestId not found (respond*() return void)
    return c.json({ ok: true }, 200)
  })
}
