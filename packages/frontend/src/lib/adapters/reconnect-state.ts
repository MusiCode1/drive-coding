/**
 * reconnect-state.ts — predicate טהור (ללא IO) עבור כפתור ה-Reconnect
 * ב-ActiveProcessesPanel.
 *
 * slice: reconnect-ws-takeover, Commit 2 — ה-BE עכשיו תומך ב-takeover
 * (WS חדש מדיח ישן, ראה ws-agent.ts), כך שסוכן "בשימוש" (attached===true)
 * כבר לא צריך להיות disabled — הכפתור מאפשר ליזום takeover.
 *
 * 3-מצבי (לא boolean) כי גם ה-title בפאנל 3-דרכי:
 *  - "disabled"  — אין acpSessionId בכלל (אין למה להתחבר)
 *  - "takeover"  — יש acpSessionId + הסוכן attached במקום אחר (דורש אישור)
 *  - "reconnect" — יש acpSessionId + לא attached (reconnect רגיל, ללא אישור)
 */
import type { AgentPublic } from "@drive-coding/core"

export type ReconnectState = "disabled" | "reconnect" | "takeover"

export function reconnectState(
  agent: Pick<AgentPublic, "acpSessionId" | "attached">,
): ReconnectState {
  if (!agent.acpSessionId) return "disabled"
  if (agent.attached === true) return "takeover"
  return "reconnect"
}

/**
 * hasConnectionRing — predicate טהור: האם להציג טבעת-חיבור סביב ה-status-dot
 * ב-ActiveProcessesPanel (slice reconnect-ws-takeover, Commit 3 — 3b).
 *
 * ממד נפרד מ-statusColor (מצב-תהליך): הצבע נשאר accent/dim/recording לפי
 * agent.status; הטבעת מציינת חיבור (attached===true) בלבד, ללא קשר לצבע.
 */
export function hasConnectionRing(agent: Pick<AgentPublic, "attached">): boolean {
  return agent.attached === true
}
