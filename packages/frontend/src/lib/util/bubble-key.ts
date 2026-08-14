import type { Bubble } from "$lib/types/bubble"

/**
 * stableBubbleKey — מפתח-זהות יציב לרינדור (getKey ל-virtua + turn-boundary).
 *
 * חובה לכלול kind — thought+message של claude חולקים messageId (אביגיל r1 🔴:
 * בלעדיו שתי הבועות מקבלות אותו מפתח → קריסת keyed-each).
 *
 * `siblings` נדרש כדי להפריד מופעים לא-רצופים של אותו (kind, messageId) —
 * למשל message → tool → message עם אותו messageId. n = מספר המופע לפי סדר
 * הרשימה (1-based). המופע הראשון בלי סיומת (reconnect של המקרה הנפוץ נשאר
 * `message:m:<id>`); השני והלאה: `:n2`, `:n3`, … — דטרמיניסטי לפי סדר, לא UUID.
 *
 * message/thought/user עם messageId → `${kind}:m:${messageId}` או `:n{k}`
 * tool → `${kind}:t:${toolCall.toolCallId}`
 * fallback (messageId=null, לא-tool: Gemini/user חי) → `${kind}:i:${id}`
 */
export function stableBubbleKey(b: Bubble, siblings: readonly Bubble[]): string {
  if (b.kind === "tool") return `${b.kind}:t:${b.toolCall.toolCallId}`
  if (b.messageId === null) return `${b.kind}:i:${b.id}`

  let n = 0
  for (const x of siblings) {
    if (x.kind === b.kind && x.messageId === b.messageId) {
      n++
      if (x.id === b.id) break
    }
  }
  if (n <= 1) return `${b.kind}:m:${b.messageId}`
  return `${b.kind}:m:${b.messageId}:n${n}`
}
