import type { Bubble } from "$lib/types/bubble"

/**
 * stableBubbleKey — מפתח-זהות יציב לרינדור (getKey ל-virtua + turn-boundary).
 *
 * חובה לכלול kind — thought+message של claude חולקים messageId (אביגיל r1 🔴:
 * בלעדיו שתי הבועות מקבלות אותו מפתח → קריסת keyed-each).
 *
 * message/thought/user עם messageId → `${kind}:m:${messageId}:${id}`
 * tool → `${kind}:t:${toolCall.toolCallId}`
 * fallback (messageId=null, לא-tool: Gemini/user חי) → `${kind}:i:${id}`
 */
export function stableBubbleKey(b: Bubble): string {
  if (b.kind === "tool") return `${b.kind}:t:${b.toolCall.toolCallId}`
  if (b.messageId !== null) return `${b.kind}:m:${b.messageId}:${b.id}`
  return `${b.kind}:i:${b.id}`
}
