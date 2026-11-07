/**
 * last-assistant-text.ts — extract truncated last assistant message for event prompts.
 */

export const LAST_ASSISTANT_TEXT_MAX_CHARS = 2048

type MessageLike = {
  role: string
  segments?: ReadonlyArray<{ text: string }>
}

export type LastAssistantQuote = { text: string; truncated: boolean }

/** Last assistant message in session (may be from a prior turn), with truncation metadata. */
export function extractLastAssistantQuote(
  messages: ReadonlyArray<MessageLike>,
): LastAssistantQuote | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== "assistant") continue
    const full = (msg.segments ?? []).map((s) => s.text).join("")
    if (full.length === 0) continue
    const truncated = full.length > LAST_ASSISTANT_TEXT_MAX_CHARS
    const text = truncated
      ? `${full.slice(0, LAST_ASSISTANT_TEXT_MAX_CHARS)}…`
      : full
    return { text, truncated }
  }
  return undefined
}

/** Last assistant message text from session messages, truncated when over max chars. */
export function extractLastAssistantText(
  messages: ReadonlyArray<MessageLike>,
): string | undefined {
  return extractLastAssistantQuote(messages)?.text
}
