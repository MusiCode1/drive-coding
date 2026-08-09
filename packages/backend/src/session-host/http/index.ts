/**
 * http/index.ts — exports registerSessionHostHttp (S4 C5).
 *
 * Wires all 4 session-host HTTP routes to a Hono app:
 *   GET  /api/agents/:id/events — SSE snapshot→patches
 *   POST /api/agents/:id/rpc    — 202 Accepted, method dispatch
 *   POST /api/agents/:id/reply  — kind discriminator (permission/elicitation)
 *   GET  /api/agents/:id/state  — one-shot snapshot (debug/health)
 *
 * ─── slice session-host-http C5 ───
 */

import type { Hono } from "hono"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import { createAgentSessionRegistry } from "../registry.js"
import { registerEventsRoute } from "./events.js"
import { registerRpcRoute } from "./rpc.js"
import { registerReplyRoute } from "./reply.js"
import { registerStateRoute } from "./state.js"

export type RegisterSessionHostHttpOpts = {
  /** AgentSessionRegistry — created externally and passed in for wiring */
  agentSessionRegistry: ReturnType<typeof createAgentSessionRegistry>
}

/**
 * registerSessionHostHttp — registers the 4 session-host HTTP routes.
 *
 * Called from server.ts after creating agentSessionRegistry.
 * Follows the same pattern as registerAgentsHttp / registerOptionsHttp.
 */
export function registerSessionHostHttp(
  app: Hono,
  opts: RegisterSessionHostHttpOpts,
): void {
  const { agentSessionRegistry } = opts
  registerEventsRoute(app, agentSessionRegistry)
  registerRpcRoute(app, agentSessionRegistry)
  registerReplyRoute(app, agentSessionRegistry)
  registerStateRoute(app, agentSessionRegistry)
}

/**
 * createAndRegisterSessionHostHttp — convenience: creates registry + registers routes.
 * For server.ts wiring: pass connectionRegistry to build the AgentSessionRegistry.
 */
export function createAndRegisterSessionHostHttp(
  app: Hono,
  connectionRegistry: ConnectionRegistry,
): ReturnType<typeof createAgentSessionRegistry> {
  const agentSessionRegistry = createAgentSessionRegistry({ connectionRegistry })
  registerSessionHostHttp(app, { agentSessionRegistry })
  return agentSessionRegistry
}
