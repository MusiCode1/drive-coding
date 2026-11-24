import type { Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { dispatchReply } from "../channel/reply-dispatch.js"
import type { AgentSessionRegistry } from "../registry.js"

export { setSelfApproveGuardForTests } from "../channel/reply-dispatch.js"

/** POST /api/agents/:id/reply. Scope enforcement is mounted by bindScopeEnforcement. */
export function registerReplyRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.post("/api/agents/:id/reply", async (c) => {
    const response = await dispatchReply(registry, c.req.param("id"), () => c.req.json(), {
      header: (name) => c.req.header(name),
    })
    return c.json(response.body, response.status as ContentfulStatusCode)
  })
}
