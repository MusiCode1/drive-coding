/**
 * agent-events-deliver.ts — deliver AgentEvent to SSE watchers and subscriber prompts.
 */

import type { AgentEvent } from "@drive-coding/core"
import { serializeDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import { createLogger } from "@drive-coding/core/log"
import type { AgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import {
  extractLastAssistantQuote,
  type LastAssistantQuote,
} from "./last-assistant-text.js"

const log = createLogger("backend.agent-events.deliver")

/** System envelope prompt for subscriber delivery (slice be-events-subscribe C3). */
export function formatAgentEventPrompt(
  event: AgentEvent,
  extras?: { lastAssistantText?: LastAssistantQuote },
): string {
  const lastAssistantText =
    event.kind === "turn-ended" && extras?.lastAssistantText !== undefined
      ? extras.lastAssistantText
      : undefined
  return serializeDriveMessage({
    source: "system",
    eventKind: event.kind,
    subjectAgent: { id: event.agentId },
    at: event.at,
    ...(event.stopReason !== undefined ? { stopReason: event.stopReason } : {}),
    ...(event.silentMs !== undefined ? { silentMs: event.silentMs } : {}),
    ...(event.lastTurnError != null ? { lastTurnError: event.lastTurnError } : {}),
    ...(lastAssistantText !== undefined ? { lastAssistantText } : {}),
  })
}

function deliverToSubscriber(
  registry: AgentSessionRegistry,
  subscriberId: string,
  event: AgentEvent,
  extras?: { lastAssistantText?: LastAssistantQuote },
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
      void host.prompt(sessionId, formatAgentEventPrompt(event, extras)).catch((err) => {
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
      let extras: { lastAssistantText?: LastAssistantQuote } | undefined
      if (
        event.kind === "turn-ended" &&
        deps.eventBus.optionsOf(event.agentId, subscriberId)?.includeLastAssistantText === true &&
        targetHost
      ) {
        const quote = extractLastAssistantQuote(targetHost.state.messages)
        if (quote !== undefined) {
          extras = { lastAssistantText: quote }
        }
      }
      deliverToSubscriber(deps.agentSessionRegistry, subscriberId, event, extras)
    }
  })
}
