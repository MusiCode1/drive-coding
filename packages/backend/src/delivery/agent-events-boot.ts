/**
 * agent-events-boot.ts — boot wiring for agent event bus (slice be-events-subscribe).
 */

import type { Hono } from "hono"
import type { AgentRegistry } from "@drive-coding/core"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { AgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { createTurnEndedEmitter } from "../session-host/agent-events-turn.js"
import { wireAgentEventDelivery } from "./agent-events-deliver.js"
import { registerAgentEventsHttp } from "./agent-events-http.js"
import { wrapOrchestratorWithAgentEvents } from "./agent-events-orchestrator.js"

export type AgentEventsBoot = {
  orchestrator: AgentOrchestrator
}

export function agentEventSessionHostOpts(eventBus: AgentEventBus) {
  return { onTurnEnded: createTurnEndedEmitter(eventBus) }
}

export function bootAgentEvents(
  app: Hono,
  deps: {
    registry: AgentRegistry
    orchestrator: AgentOrchestrator
    eventBus: AgentEventBus
    agentSessionRegistry: AgentSessionRegistry
  },
): AgentEventsBoot {
  registerAgentEventsHttp(app, { registry: deps.registry, eventBus: deps.eventBus })
  const orchestrator = wrapOrchestratorWithAgentEvents(deps.orchestrator, deps.eventBus)
  wireAgentEventDelivery({
    eventBus: deps.eventBus,
    agentSessionRegistry: deps.agentSessionRegistry,
  })
  return { orchestrator }
}
