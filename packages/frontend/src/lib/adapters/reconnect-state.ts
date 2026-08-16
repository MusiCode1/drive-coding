/**
 * reconnect-state.ts — predicate טהור (ללא IO) עבור כפתור ה-Reconnect
 * ב-ActiveProcessesPanel.
 *
 * slice: reconnect-ws-takeover, Commit 2 — ה-BE עכשיו תומך ב-takeover
 * (WS חדש מדיח ישן, ראה ws-agent.ts), כך שסוכן "בשימוש" (attached===true)
 * כבר לא צריך להיות disabled — הכפתור מאפשר ליזום takeover.
 *
 * slice liveness C4: hasConnectionRing משתמש בממד "מחובר" (attached + lastSeenAt טרי),
 * לא ב-attached בלבד (§2 — סוקט פתוח ניתן לזיוף).
 */
import type { AgentPublic } from "@drive-coding/core"
import {
  isAgentConnected,
  isAgentResumable,
  isAgentRunning,
  type LivenessAgent,
} from "./liveness-state"

export type ReconnectState = "disabled" | "reconnect" | "takeover"

export { isAgentConnected, isAgentResumable, isAgentRunning }

export function reconnectState(
  agent: Pick<AgentPublic, "acpSessionId" | "attached">,
): ReconnectState {
  if (!agent.acpSessionId) return "disabled"
  if (agent.attached === true) return "takeover"
  return "reconnect"
}

/**
 * hasConnectionRing — predicate טהור: האם להציג טבעת-חיבור סביב ה-status-dot
 * ב-ActiveProcessesPanel (slice reconnect-ws-takeover, Commit 3 — 3b;
 * slice liveness C4 — ממד connected).
 */
export function hasConnectionRing(agent: LivenessAgent, now = Date.now()): boolean {
  return isAgentConnected(agent, now)
}
