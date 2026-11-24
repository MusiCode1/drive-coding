import type { AgentRegistry } from "@drive-coding/core"
import type { Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { dispatchRpcBody } from "../channel/rpc-dispatch.js"
import type { AgentSessionRegistry } from "../registry.js"

export {
  AudioBlock,
  CancelParams,
  DeleteSessionParams,
  ImageBlock,
  LoadSessionParams,
  NewSessionParams,
  PromptParams,
  ResourceBlock,
  ResourceLinkBlock,
  TextBlock,
} from "../channel/rpc-dispatch.js"

/** POST /api/agents/:id/rpc */
export function registerRpcRoute(
  app: Hono,
  registry: AgentSessionRegistry,
  agentRegistry: AgentRegistry,
): void {
  app.post("/api/agents/:id/rpc", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const response = await dispatchRpcBody(
      { registry: agentRegistry, sessionRegistry: registry },
      c.req.param("id"),
      body,
      { header: (name) => c.req.header(name) },
    )
    return c.json(response.body, response.status as ContentfulStatusCode)
  })
}
