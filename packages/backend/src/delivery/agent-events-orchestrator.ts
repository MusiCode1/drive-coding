/**
 * agent-events-orchestrator.ts — wrap createAndSpawn for notifyOnDone auto-subscribe.
 */

import type { CreateAndSpawnInput } from "../app/agent-orchestrator.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { AgentEventBus } from "../session-host/agent-events.js"
import { subscribeNotifyOnDone } from "./agent-events-http.js"

export function wrapOrchestratorWithAgentEvents(
  orchestrator: AgentOrchestrator,
  eventBus: AgentEventBus,
): AgentOrchestrator {
  return {
    ...orchestrator,
    async createAndSpawn(input: CreateAndSpawnInput) {
      const result = await orchestrator.createAndSpawn(input)
      subscribeNotifyOnDone(eventBus, result.agentId, input.notifyOnDone, {
        includeLastAssistantText: input.includeLastAssistantText === true,
      })
      return result
    },
  }
}
