/**
 * agent-events-turn.ts — turn-ended → AgentEventBus wiring (slice be-events-subscribe C1).
 */

import type { AgentEventBus } from "../session-host/agent-events.js"

export type TurnEndedInfo = {
  stopReason?: string
  lastTurnError?: { message: string; at: number } | null
}

export type OnTurnEndedHandler = (agentId: string, info: TurnEndedInfo) => void

export function createTurnEndedEmitter(eventBus: AgentEventBus): OnTurnEndedHandler {
  return (agentId, info) => {
    eventBus.emit({
      kind: "turn-ended",
      agentId,
      at: Date.now(),
      ...(info.stopReason !== undefined ? { stopReason: info.stopReason } : {}),
      ...(info.lastTurnError !== undefined && info.lastTurnError !== null
        ? { lastTurnError: { message: info.lastTurnError.message } }
        : info.lastTurnError === null
          ? { lastTurnError: null }
          : {}),
    })
  }
}
