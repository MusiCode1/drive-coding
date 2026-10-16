import type { Bubble, MessageBubble, UserBubble } from "$lib/types/bubble"

export type AppendContent =
  | { kind: "image"; image: { mimeType: string; data: string } }
  | {
      kind: "user-placeholder"
      placeholder: NonNullable<UserBubble["contentPlaceholders"]>[number]
    }
  | {
      kind: "agent-placeholder"
      placeholder: NonNullable<MessageBubble["contentPlaceholders"]>[number]
    }
export type AppendCreation = { id: string; createdAt: number }

export function canGroupAppend(
  bubbles: readonly Bubble[],
  messageId: string | null,
  content: AppendContent,
): boolean {
  const last = bubbles.at(-1)
  return (
    last?.kind === (content.kind === "agent-placeholder" ? "message" : "user") &&
    last.messageId === messageId
  )
}

/** Data-only reduction: no mutation, clocks, UUIDs, callbacks or Svelte. */
export function reduceTranscriptAppend(
  bubbles: readonly Bubble[],
  messageId: string | null,
  content: AppendContent,
  creation: AppendCreation | undefined,
): Bubble[] {
  const last = bubbles.at(-1)
  const group = canGroupAppend(bubbles, messageId, content)
  let next: UserBubble | MessageBubble
  if (group && last && (last.kind === "user" || last.kind === "message")) next = { ...last }
  else {
    if (!creation) throw new Error("append requires creation metadata")
    next = {
      ...creation,
      kind: content.kind === "agent-placeholder" ? "message" : "user",
      messageId,
      segments: [],
    }
  }
  if (content.kind === "image" && next.kind === "user") {
    next = {
      ...next,
      attachments: [
        ...(next.attachments ?? []),
        { mimeType: content.image.mimeType, dataBase64: content.image.data },
      ],
    }
  } else if (content.kind === "user-placeholder" && next.kind === "user") {
    next = {
      ...next,
      contentPlaceholders: [...(next.contentPlaceholders ?? []), content.placeholder],
    }
  } else if (content.kind === "agent-placeholder" && next.kind === "message") {
    next = {
      ...next,
      contentPlaceholders: [...(next.contentPlaceholders ?? []), content.placeholder],
    }
  }
  return group ? [...bubbles.slice(0, -1), next] : [...bubbles, next]
}
