/**
 * agent-events-deliver.ts — deliver AgentEvent to SSE watchers and subscriber prompts.
 */

import type { AgentEvent } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { AgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"

const log = createLogger("backend.agent-events.deliver")

/** Facts-only prompt template for subscriber delivery (slice be-events-subscribe C3). */
export function formatAgentEventPrompt(event: AgentEvent): string {
  const lines = [
    "[drive-coding event]",
    `kind: ${event.kind}`,
    `agentId: ${event.agentId}`,
    `at: ${event.at}`,
  ]
  if (event.stopReason !== undefined) {
    lines.push(`stopReason: ${event.stopReason}`)
  }
  if (event.silentMs !== undefined) {
    lines.push(`silentMs: ${event.silentMs}`)
  }
  if (event.lastTurnError != null) {
    lines.push(`lastTurnError.message: ${event.lastTurnError.message}`)
  }
  return lines.join("\n")
}

function deliverToSubscriber(
  registry: AgentSessionRegistry,
  subscriberId: string,
  event: AgentEvent,
): void {
  void registry
    .getOrCreateHost(subscriberId)
    .then((hostResult) => {
      if (!hostResult.ok) {
        log.warn(
          { subscriberId, agentId: event.agentId, reason: hostResult.reason },
          "agent event: subscriber host unavailable",
        )
        return
      }
      const { host } = hostResult.entry
      const sessionId = host.state.sessionId
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        log.warn({ subscriberId, agentId: event.agentId }, "agent event: subscriber has no sessionId")
        return
      }
      void host.prompt(sessionId, formatAgentEventPrompt(event)).catch((err) => {
        log.warn({ err, subscriberId, agentId: event.agentId }, "agent event: subscriber prompt failed")
      })
    })
    .catch((err) => {
      log.warn({ err, subscriberId, agentId: event.agentId }, "agent event: getOrCreateHost failed")
    })
}

/** Wire bus.onEvent → target SSE ext_notification + subscriber prompts. Returns unsubscribe. */
export function wireAgentEventDelivery(deps: {
  eventBus: AgentEventBus
  agentSessionRegistry: AgentSessionRegistry
}): () => void {
  return deps.eventBus.onEvent((event, subscriberIds) => {
    const targetHost = deps.agentSessionRegistry.getHost(event.agentId)
    if (targetHost) {
      targetHost.emitExtNotification("_drive/agent_event", { ...event })
    }
    for (const subscriberId of subscriberIds) {
      deliverToSubscriber(deps.agentSessionRegistry, subscriberId, event)
    }
  })
}
