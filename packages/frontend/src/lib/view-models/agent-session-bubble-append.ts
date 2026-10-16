import { safeUUID } from "$lib/util/uuid"
import { type AppendContent, canGroupAppend } from "./transcript-append"
import type { TranscriptScope } from "./transcript-scope.svelte"

/** Imperative shell generates metadata only for a newly created bubble. */
function appendContent(
  owner: TranscriptScope,
  messageId: string | null,
  content: AppendContent,
): void {
  const creation = canGroupAppend(owner.bubbles, messageId, content)
    ? undefined
    : { id: safeUUID(), createdAt: Date.now() }
  owner.appendContent(messageId, content, creation)
}
export function appendUserImage(
  owner: TranscriptScope,
  messageId: string | null,
  img: { mimeType: string; data: string },
): void {
  appendContent(owner, messageId, { kind: "image", image: img })
}
export function appendUserPlaceholder(
  owner: TranscriptScope,
  messageId: string | null,
  ph: { kind: "resource_link" | "audio" | "resource"; label?: string; uri?: string },
): void {
  appendContent(owner, messageId, { kind: "user-placeholder", placeholder: ph })
}
export function appendAgentPlaceholder(
  owner: TranscriptScope,
  messageId: string | null,
  ph: { kind: "resource_link" | "audio" | "resource" | "image"; label?: string; uri?: string },
): void {
  appendContent(owner, messageId, { kind: "agent-placeholder", placeholder: ph })
}
