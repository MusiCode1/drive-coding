/**
 * connection.ts — DELETE /api/agents/:id/connection (slice connection-set C0).
 *
 * Removes one viewer row from the connection set. Does NOT kill the agent,
 * close the broadcaster, or unregister the session host.
 */

import type { Hono } from "hono"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import { readConnectionId } from "./connection-id.js"

export type ConnectionRouteOpts = {
  closeLiveSocket?: (agentId: string, connectionId: string) => void
}

export function registerConnectionRoute(
  app: Hono,
  connectionRegistry: ConnectionRegistry,
  opts: ConnectionRouteOpts = {},
): void {
  app.delete("/api/agents/:id/connection", (c) => {
    const agentId = c.req.param("id")

    if (!connectionRegistry.get(agentId)) {
      return c.body(null, 404)
    }

    const connectionId = readConnectionId(c)
    if (connectionId !== undefined) {
      connectionRegistry.removeConnection(agentId, connectionId)
      opts.closeLiveSocket?.(agentId, connectionId)
    }

    return c.body(null, 204)
  })
}
