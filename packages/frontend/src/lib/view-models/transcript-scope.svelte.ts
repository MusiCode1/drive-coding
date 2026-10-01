import type { Patch } from "@drive-coding/core/session"
import { applyPatchMutable } from "$lib/session/apply-patch-mutable"
import type { FramePatch } from "$lib/session/frame-router"
import { mapLocations, mapToolContent } from "$lib/session/map-tool-content"
import type { Bubble, ThoughtBubble, ToolBubble, UserBubble } from "$lib/types/bubble"
import { safeUUID } from "$lib/util/uuid"
import { type ClaudeSubagentEvent, reduceSubagent } from "./claude-subagent-parse"
import type { PatchOwner } from "./scopes/apply-patch"

export type TranscriptPatch = { readonly kind: "frame"; readonly patches: Patch[] }
type ContentPatch = Extract<FramePatch, { messageId: string | null }>

/** Owns the displayed transcript for exactly one session identity. */
export class TranscriptScope implements PatchOwner<TranscriptPatch> {
  readonly sessionId: string | null
  #bubbles = $state<Bubble[]>([])
  #displaySnapshot = $state<Bubble[] | null>(null)

  constructor(sessionId: string | null) {
    this.sessionId = sessionId
  }
  get bubbles(): Bubble[] {
    return this.#bubbles
  }
  get renderBubbles(): Bubble[] {
    return this.#displaySnapshot ?? this.#bubbles
  }
  get isReconnectReplay(): boolean {
    return this.#displaySnapshot !== null
  }

  recentAssistantMessages(n: number = 3): string[] {
    const result: string[] = []
    for (let i = this.#bubbles.length - 1; i >= 0 && result.length < n; i--) {
      const bubble = this.#bubbles[i]
      if (bubble?.kind === "message") result.unshift(bubble.segments.map((s) => s.text).join(""))
    }
    return result
  }

  applyPatch(patch: TranscriptPatch): void {
    applyPatchMutable(this.#bubbles, patch.patches, { mapToolContent, mapLocations })
  }

  replace(bubbles: Bubble[]): void {
    this.#bubbles = bubbles
  }
  appendOptimistic(bubble: UserBubble): void {
    this.#bubbles.push(bubble)
  }
  freezeDisplay(): void {
    if (this.#displaySnapshot === null) this.#displaySnapshot = this.#bubbles
  }
  beginReplay(): void {
    this.freezeDisplay()
    this.#bubbles = []
  }
  connected(): void {
    this.#displaySnapshot = null
  }
  setMessageId(messageId: string): void {
    for (let i = this.#bubbles.length - 1; i >= 0; i--) {
      const bubble = this.#bubbles[i]
      if (
        bubble?.kind === "user" &&
        (bubble.messageId === messageId || bubble.messageId === null)
      ) {
        if (bubble.messageId === null) bubble.messageId = messageId
        break
      }
    }
  }
  applySubagentEvent(parentId: string, event: ClaudeSubagentEvent): boolean {
    const idx = this.#bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
    )
    const task = this.#bubbles[idx]
    if (idx < 0 || task?.kind !== "tool") return false
    this.#bubbles[idx] = reduceSubagent(task, event)
    return true
  }
  applySubagentEvents(parentId: string, events: ClaudeSubagentEvent[]): void {
    const idx = this.#bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
    )
    let task = this.#bubbles[idx]
    if (idx < 0 || task?.kind !== "tool") return
    for (const event of events) task = reduceSubagent(task, event)
    this.#bubbles[idx] = task
  }
  appendNestedTool(parentId: string, child: ToolBubble): boolean {
    const idx = this.#bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
    )
    const parent = this.#bubbles[idx]
    if (idx < 0 || parent?.kind !== "tool") return false
    this.#bubbles[idx] = { ...parent, subFrames: [...(parent.subFrames ?? []), child] }
    return true
  }
  updateNestedTool(
    parentId: string,
    childId: string,
    update: (child: ToolBubble) => ToolBubble,
  ): void {
    const idx = this.#bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
    )
    const parent = this.#bubbles[idx]
    if (idx < 0 || parent?.kind !== "tool") return
    const subFrames = [...(parent.subFrames ?? [])]
    const childIdx = subFrames.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === childId,
    )
    const child = subFrames[childIdx]
    if (childIdx < 0 || child?.kind !== "tool") return
    subFrames[childIdx] = update(child)
    this.#bubbles[idx] = { ...parent, subFrames }
  }
  annotateNarration(bubbleId: string, text: string): void {
    const idx = this.#bubbles.findIndex((b) => b.id === bubbleId)
    const bubble = this.#bubbles[idx]
    if (bubble?.kind === "tool")
      this.#bubbles[idx] = { ...bubble, toolCall: { ...bubble.toolCall, narration: text } }
  }
  annotateTranslation(
    bubbleId: string,
    segmentIndex: number,
    originalText: string,
    translatedText: string,
  ): boolean {
    const idx = this.#bubbles.findIndex((b) => b.id === bubbleId)
    const bubble = this.#bubbles[idx]
    if (bubble?.kind !== "thought" || segmentIndex >= bubble.segments.length) return false
    const segments: ThoughtBubble["segments"] = bubble.segments.map((seg, i) =>
      i === segmentIndex ? { ...seg, text: translatedText, originalText } : seg,
    )
    this.#bubbles[idx] = { ...bubble, segments }
    return true
  }
  appendUserImage(messageId: string | null, image: { mimeType: string; data: string }): void {
    const last = this.#bubbles.at(-1)
    const attachment = { mimeType: image.mimeType, dataBase64: image.data }
    if (last?.kind === "user" && last.messageId === messageId) {
      last.attachments = [...(last.attachments ?? []), attachment]
    } else {
      this.#bubbles.push({
        id: safeUUID(),
        kind: "user",
        messageId,
        createdAt: Date.now(),
        segments: [],
        attachments: [attachment],
      })
    }
  }
  appendUserPlaceholder(
    messageId: string | null,
    ph: { kind: "resource_link" | "audio" | "resource"; label?: string; uri?: string },
  ): void {
    const last = this.#bubbles.at(-1)
    if (last?.kind === "user" && last.messageId === messageId) {
      last.contentPlaceholders = [...(last.contentPlaceholders ?? []), ph]
    } else {
      this.#bubbles.push({
        id: safeUUID(),
        kind: "user",
        messageId,
        createdAt: Date.now(),
        segments: [],
        contentPlaceholders: [ph],
      })
    }
  }
  appendAgentPlaceholder(
    messageId: string | null,
    ph: { kind: "resource_link" | "audio" | "resource" | "image"; label?: string; uri?: string },
  ): void {
    const last = this.#bubbles.at(-1)
    if (last?.kind === "message" && last.messageId === messageId) {
      last.contentPlaceholders = [...(last.contentPlaceholders ?? []), ph]
    } else {
      this.#bubbles.push({
        id: safeUUID(),
        kind: "message",
        messageId,
        createdAt: Date.now(),
        segments: [],
        contentPlaceholders: [ph],
      })
    }
  }

  appendNonText(patch: ContentPatch, content?: { name?: string; uri?: string }): void {
    if (patch.kind === "user-image") {
      this.appendUserImage(patch.messageId, { mimeType: patch.mimeType, data: patch.data })
    } else if (patch.kind === "user-resource-link" || patch.kind === "agent-resource-link") {
      const placeholder = {
        kind: "resource_link" as const,
        label:
          content?.name ?? content?.uri ?? (patch.kind === "agent-resource-link" ? "" : undefined),
        uri: content?.uri,
      }
      if (patch.kind === "user-resource-link")
        this.appendUserPlaceholder(patch.messageId, placeholder)
      else this.appendAgentPlaceholder(patch.messageId, placeholder)
    } else if (patch.kind === "agent-image") {
      this.appendAgentPlaceholder(patch.messageId, { kind: "image" })
    } else if (patch.kind === "user-audio" || patch.kind === "user-placeholder") {
      this.appendUserPlaceholder(patch.messageId, {
        kind: patch.kind === "user-audio" ? "audio" : "resource",
      })
    } else if (patch.kind === "agent-audio" || patch.kind === "agent-placeholder") {
      this.appendAgentPlaceholder(patch.messageId, {
        kind: patch.kind === "agent-audio" ? "audio" : "resource",
      })
    }
  }
}
