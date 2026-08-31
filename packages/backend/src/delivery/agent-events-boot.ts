/**
 * agent-events-boot.ts — boot wiring for agent event bus (slice be-events-subscribe).
 */

import type { Hono } from "hono"
import type { AgentRegistry } from "@drive-coding/core"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { createAgentEventBus, type AgentEventBus } from "../session-host/agent-events.js"
import { registerAgentEventsHttp } from "./agent-events-http.js"
import { wrapOrchestratorWithAgentEvents } from "./agent-events-orchestrator.js"

export type AgentEventsBoot = {
  eventBus: AgentEventBus
  orchestrator: AgentOrchestrator
}

export function bootAgentEvents(
  app: Hono,
  deps: { registry: AgentRegistry; orchestrator: AgentOrchestrator },
): AgentEventsBoot {
  const eventBus = createAgentEventBus()
  registerAgentEventsHttp(app, { registry: deps.registry, eventBus })
  const orchestrator = wrapOrchestratorWithAgentEvents(deps.orchestrator, eventBus)
  return { eventBus, orchestrator }
}
