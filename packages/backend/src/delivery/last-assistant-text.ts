/**
 * last-assistant-text.ts — extract truncated last assistant message for event prompts.
 */

export const LAST_ASSISTANT_TEXT_MAX_CHARS = 2048

type MessageLike = {
  role: string
  segments?: ReadonlyArray<{ text: string }>
}

/** Last assistant message text from session messages, truncated when over max chars. */
export function extractLastAssistantText(
  messages: ReadonlyArray<MessageLike>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== "assistant") continue
    const text = (msg.segments ?? []).map((s) => s.text).join("")
    if (text.length === 0) return undefined
    if (text.length > LAST_ASSISTANT_TEXT_MAX_CHARS) {
      return `${text.slice(0, LAST_ASSISTANT_TEXT_MAX_CHARS)}…`
    }
    return text
  }
  return undefined
}
