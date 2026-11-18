import { type } from "arktype"

export type AgentEventKind = "turn-ended" | "stall-suspected"

export type AgentEvent = {
  kind: AgentEventKind
  agentId: string
  at: number
  stopReason?: string
  silentMs?: number
  lastTurnError?: { message: string } | null
}

/** POST /api/agents/:id/subscribe body */
export const AgentSubscribeBody = type({
  subscriberAgentId: "string.uuid",
  "includeLastAssistantText?": type("boolean").describe(
    "When true, turn-ended prompts include a truncated preview of the target agent's last assistant message.",
  ),
})
export type AgentSubscribeBody = typeof AgentSubscribeBody.infer

/** MCP session_subscribe input */
export const AgentSubscribeInput = type({
  agent: type("string >= 1").describe("Target agent UUID to subscribe to."),
  "subscriber?": type("string >= 1").describe(
    "Subscriber agent UUID. Defaults to X-Drive-Coding-Agent header when present.",
  ),
  "includeLastAssistantText?": type("boolean").describe(
    "When true, turn-ended prompts include a truncated preview of the target agent's last assistant message.",
  ),
})
export type AgentSubscribeInput = typeof AgentSubscribeInput.infer
