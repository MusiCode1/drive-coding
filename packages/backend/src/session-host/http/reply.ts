/**
 * reply.ts — POST /api/agents/:id/reply (S4 C4).
 *
 * Responds to pending agent requests (permission / elicitation).
 *
 * Body: { kind: "permission" | "elicitation", requestId: number, result: unknown }
 *
 * Kind discriminator is required — permission and elicitation are two separate
 * PendingRequests maps (kind routes between them), even though `requestId` is
 * now (slice session-host-pending-surface C4) a single shared counter that is
 * unique across both types. `kind` stays required regardless: it's what tells
 * this route which map to look the id up in.
 *
 * Returns:
 *   - 404 if host not found (not an active connection)
 *   - 200 OK on success — silent no-op if requestId not found
 *     (respondPermission / respondElicitation return void)
 *
 * ─── slice session-host-http C4 (TDD) ───
 * ─── slice session-host-pending-surface C4: JSDoc-only — shared requestId counter ───
 */

import type { Hono } from "hono"
import { verifyToken } from "../../agent-scope.js"
import { readScopeToken, scopeDeniedBody } from "../../scope-write.js"
import type { AgentSessionRegistry } from "../registry.js"

let selfApproveGuardEnabled = true

/** Test hook (G5): disabling makes scope self-approve return 200 like the FE path. */
export function setSelfApproveGuardForTests(enabled: boolean): void {
  selfApproveGuardEnabled = enabled
}

/**
 * registerReplyRoute — registers POST /api/agents/:id/reply on the Hono app.
 * Scope enforcement: bindScopeEnforcement middleware (slice agent-scopes C2).
 */
export function registerReplyRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.post("/api/agents/:id/reply", async (c) => {
    const agentId = c.req.param("id")

    const host = registry.getHost(agentId)
    if (!host) {
      return c.json({ error: "Agent connection not found" }, 404)
    }
    registry.touchOwner(agentId)

    const body = (await c.req.json()) as Record<string, unknown>
    const kind = body.kind as "permission" | "elicitation"
    const requestId = body.requestId as number
    const result = body.result

    if (kind === "permission" && selfApproveGuardEnabled && host.isScopeRequest(requestId)) {
      const token = readScopeToken((name) => c.req.header(name))
      if (token && verifyToken(token)) {
        return c.json(scopeDeniedBody(), 403)
      }
    }

    if (kind === "permission") {
      host.respondPermission(requestId, result as Parameters<typeof host.respondPermission>[1])
    } else if (kind === "elicitation") {
      host.respondElicitation(requestId, result as Parameters<typeof host.respondElicitation>[1])
    } else {
      return c.json({ error: `Unknown kind: ${String(body.kind)}` }, 400)
    }

    return c.json({ ok: true }, 200)
  })
}
