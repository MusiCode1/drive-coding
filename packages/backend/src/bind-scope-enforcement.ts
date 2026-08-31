/**
 * bind-scope-enforcement.ts — scoped-write middleware for agent HTTP routes (C2).
 */

import type { AgentRegistry } from "@drive-coding/core"
import type { Hono } from "hono"
import { whenScopedWriteAllowed, SCOPE_DENIED_BODY } from "./scope-write.js"
import type { AgentSessionRegistry } from "./session-host/registry.js"

export type ScopeEnforcementDeps = {
  registry: AgentRegistry
  sessionRegistry: AgentSessionRegistry
}

/** Mount scoped-write guards on DELETE/PATCH/reply (rpc stays in rpc.ts — body peek). */
export function bindScopeEnforcement(app: Hono, deps: ScopeEnforcementDeps): void {
  app.use("/api/agents/:id", async (c, next) => {
    const method = c.req.method
    if (method !== "DELETE" && method !== "PATCH") return next()
    const allowed = await whenScopedWriteAllowed((name) => c.req.header(name), {
      targetId: c.req.param("id"),
      verb: method === "DELETE" ? "close" : "patch",
      registry: deps.registry,
      sessionRegistry: deps.sessionRegistry,
    })
    if (allowed) return next()
    return c.json(SCOPE_DENIED_BODY, 403)
  })

  app.use("/api/agents/:id/reply", async (c, next) => {
    if (c.req.method !== "POST") return next()
    const allowed = await whenScopedWriteAllowed((name) => c.req.header(name), {
      targetId: c.req.param("id"),
      verb: "reply",
      registry: deps.registry,
      sessionRegistry: deps.sessionRegistry,
    })
    if (allowed) return next()
    return c.json(SCOPE_DENIED_BODY, 403)
  })
}

export function guardMcpWrite(
  scopeToken: string | undefined,
  deps: ScopeEnforcementDeps,
  targetId: string,
  verb: string,
): Promise<boolean> {
  return whenScopedWriteAllowed(() => scopeToken, {
    targetId,
    verb,
    registry: deps.registry,
    sessionRegistry: deps.sessionRegistry,
  })
}
