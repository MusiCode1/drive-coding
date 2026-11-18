import type { SessionMessage } from "@drive-coding/core/session"

/** חתך-היסטוריה: מה כבר היה כשהצטרפנו. נלקח **ברגע ה-reset**. */
export type HistoryMark = {
  /** bubbleId (= msg.id) → כמה סגמנטים היו ברגע החתך. */
  segmentCounts: Map<string, number>
  /** toolCallId של כל בועת-כלי שהייתה בחתך. */
  toolCallIds: string[]
}

export function historyMarkFromReset(messages: readonly SessionMessage[]): HistoryMark {
  const segmentCounts = new Map<string, number>()
  const toolCallIds: string[] = []
  for (const msg of messages) {
    if (msg.role === "assistant" || msg.role === "thought") {
      segmentCounts.set(msg.id, msg.segments.length)
    } else if (msg.role === "tool") {
      toolCallIds.push(msg.toolCall.toolCallId)
    }
  }
  return { segmentCounts, toolCallIds }
}
