import type { Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { dispatchPresence } from "../channel/presence-dispatch.js"
import type { AgentSessionRegistry } from "../registry.js"
import { readConnectionId } from "./connection-id.js"

/** POST /api/agents/:id/presence */
export function registerPresenceRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.post("/api/agents/:id/presence", (c) => {
    c.header("Cache-Control", "no-store")
    const response = dispatchPresence(registry, c.req.param("id"), readConnectionId(c))
    return c.json(response.body, response.status as ContentfulStatusCode)
  })
}
