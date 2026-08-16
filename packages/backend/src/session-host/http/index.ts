/**
 * http/index.ts — exports registerSessionHostHttp (S4 C5).
 *
 * Wires all 5 session-host HTTP routes to a Hono app:
 *   GET  /api/agents/:id/events — SSE snapshot→patches
 *   POST /api/agents/:id/rpc    — 202 Accepted, method dispatch
 *   POST /api/agents/:id/reply  — kind discriminator (permission/elicitation)
 *   GET  /api/agents/:id/state  — one-shot snapshot (debug/health)
 *   POST /api/agents/:id/presence — liveness heartbeat (slice liveness C1)
 *
 * ─── slice session-host-http C5 ───
 */

import type { Hono } from "hono"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import { createAgentSessionRegistry, type OnSessionAttached } from "../registry.js"
import { registerEventsRoute } from "./events.js"
import { registerPresenceRoute } from "./presence.js"
import { registerReplyRoute } from "./reply.js"
import { registerRpcRoute } from "./rpc.js"
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
  registerPresenceRoute(app, agentSessionRegistry)
}

/**
 * createAndRegisterSessionHostHttp — convenience: creates registry + registers routes.
 * For server.ts wiring: pass connectionRegistry to build the AgentSessionRegistry.
 *
 * slice remote-warm-reconnect C1: opts.onSessionAttached מועבר לרג'יסטרי — ה-host
 * מדווח את ה-session שלו לרג'יסטרי הסוכנים (ב-remote אף אחד אחר לא כותב acpSessionId).
 */
export function createAndRegisterSessionHostHttp(
  app: Hono,
  connectionRegistry: ConnectionRegistry,
  opts: {
    onSessionAttached?: OnSessionAttached
    /**
     * slice ownership-handoff C4: eviction controller for HTTP→WS takeover.
     * Injected from server.ts; allows registry to evict an active WS before
     * creating an HTTP host on the same agent.
     */
    evictionController?: Parameters<typeof createAgentSessionRegistry>[0]["evictionController"]
    /**
     * slice ownership-handoff C4: resolve acpSessionId for warm reattach.
     * Injected from server.ts via AgentRegistry; allows HTTP host to loadSession
     * instead of newSession when taking over from a WS-owned agent.
     */
    getAcpSessionId?: (agentId: string) => string | undefined
  } = {},
): ReturnType<typeof createAgentSessionRegistry> {
  const agentSessionRegistry = createAgentSessionRegistry({
    connectionRegistry,
    onSessionAttached: opts.onSessionAttached,
    evictionController: opts.evictionController,
    getAcpSessionId: opts.getAcpSessionId,
  })
  registerSessionHostHttp(app, { agentSessionRegistry })
  return agentSessionRegistry
}
