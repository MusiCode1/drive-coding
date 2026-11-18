/**
 * liveness-state.ts — predicates טהורים לממדי liveness (slice liveness C4).
 *
 * שלושה ממדים במקום attached בלבד:
 *   running   — תהליך חי (status)
 *   connected — בעלות אמיתית (attached + lastSeenAt טרי)
 *   resumable — רץ אך לא מחובר, עם acpSessionId לחזרה
 */
import type { AgentPublic } from "@drive-coding/core"
import { configDefault } from "@drive-coding/core/config/specs"

/** Same product default as BE `httpOwnerTtlMs` — freshness of lastSeenAt. */
export const LIVENESS_FRESH_MS = configDefault("httpOwnerTtlMs")

const RUNNING_STATUSES = new Set<AgentPublic["status"]>(["starting", "ready", "busy"])

export type LivenessAgent = Pick<
  AgentPublic,
  "status" | "pid" | "attached" | "lastSeenAt" | "acpSessionId"
>

export function isAgentRunning(agent: Pick<AgentPublic, "status">): boolean {
  return RUNNING_STATUSES.has(agent.status)
}

export function isAgentConnected(
  agent: Pick<AgentPublic, "attached" | "lastSeenAt">,
  now = Date.now(),
): boolean {
  if (agent.attached !== true) return false
  if (agent.lastSeenAt == null) return false
  return now - agent.lastSeenAt <= LIVENESS_FRESH_MS
}

export function isAgentResumable(agent: LivenessAgent, now = Date.now()): boolean {
  if (!agent.acpSessionId) return false
  return isAgentRunning(agent) && !isAgentConnected(agent, now)
}
