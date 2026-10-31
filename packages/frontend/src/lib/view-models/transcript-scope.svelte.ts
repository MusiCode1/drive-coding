import type { Patch } from "@drive-coding/core/session"
import { applyPatchMutable } from "$lib/session/apply-patch-mutable"
import { mapLocations, mapToolContent } from "$lib/session/map-tool-content"
import type { Bubble, ToolBubble, ToolCall } from "$lib/types/bubble"
import {
  type ClaudeSubagentEvent,
  createSubagentIndex,
  reduceSubagent,
} from "./claude-subagent-parse"
import type {
  AnnotationTarget,
  ThoughtSource,
  TranscriptProcessingTarget,
} from "./speaker-transcript-port"
import {
  type AppendContent,
  type AppendCreation,
  reduceTranscriptAppend,
} from "./transcript-append"

/** Svelte adapter for transcript construction; annotation writes validate the captured content identity. */
export class TranscriptScope {
  #subagentIndex = createSubagentIndex()
  #pendingByParent: { parentId: string; event: ClaudeSubagentEvent }[] = []
  static readonly #SUBAGENT_PENDING_CAP = 50

  /** Projection lifetime is cleanup-bound, independent from transcript content generations. */
  resetSubagentProjection(): void {
    this.#subagentIndex = createSubagentIndex()
    this.#pendingByParent = []
  }
  onSubagentEvent(event: ClaudeSubagentEvent): void {
    const parentId = this.#subagentIndex.resolve(event)
    if (parentId === undefined) return
    if (!this.#applySubagentEvents(parentId, [event])) {
      this.#pendingByParent.push({ parentId, event })
      if (this.#pendingByParent.length > TranscriptScope.#SUBAGENT_PENDING_CAP) {
        this.#pendingByParent.shift()
      }
    }
  }
  flushPendingSubagentEvents(toolCallId: string): void {
    if (this.#pendingByParent.length === 0) return
    const matching = this.#pendingByParent.filter((p) => p.parentId === toolCallId)
    if (matching.length === 0) return
    this.#pendingByParent = this.#pendingByParent.filter((p) => p.parentId !== toolCallId)
    this.#applySubagentEvents(
      toolCallId,
      matching.map((p) => p.event),
    )
  }

  #content = $state<{ bubbles: Bubble[] }>({ bubbles: [] })
  #processingTarget = $state.raw<TranscriptProcessingTarget>({} as TranscriptProcessingTarget)
  #annotationTargets = new WeakMap<object, AnnotationTarget>()
  #annotationContents = new WeakMap<AnnotationTarget, object>()

  captureProcessingTarget(): TranscriptProcessingTarget {
    return this.#processingTarget
  }
  captureAnnotationTarget(): AnnotationTarget {
    let target = this.#annotationTargets.get(this.#content)
    if (!target) {
      target = {} as AnnotationTarget
      this.#annotationTargets.set(this.#content, target)
      this.#annotationContents.set(target, this.#content)
    }
    return target
  }
  isAnnotationTargetCurrent(target: AnnotationTarget): boolean {
    return this.#annotationContents.get(target) === this.#content
  }
  writeToolNarration(
    target: AnnotationTarget,
    bubbleId: string,
    toolCallId: string,
    toolKind: string | undefined,
    text: string,
  ): boolean {
    if (!this.isAnnotationTargetCurrent(target)) return false
    const index = this.bubbles.findIndex((bubble) => bubble.id === bubbleId)
    const bubble = this.bubbles[index]
    if (
      bubble?.kind !== "tool" ||
      bubble.toolCall.toolCallId !== toolCallId ||
      bubble.toolCall.kind !== toolKind
    )
      return false
    this.#replaceAt(index, { ...bubble, toolCall: { ...bubble.toolCall, narration: text } })
    return true
  }
  writeThoughtTranslation(
    target: AnnotationTarget,
    bubbleId: string,
    segmentIndex: number,
    source: ThoughtSource,
    original: string,
    translated: string,
  ): boolean {
    if (!this.isAnnotationTargetCurrent(target)) return false
    const index = this.bubbles.findIndex((bubble) => bubble.id === bubbleId)
    const bubble = this.bubbles[index]
    if (bubble?.kind !== "thought") return false
    const segment = bubble.segments[segmentIndex]
    if (
      !segment ||
      segment.id !== source.id ||
      (segment.originalText ?? segment.text) !== source.originalText
    )
      return false
    const segments = bubble.segments.map((value, i) =>
      i === segmentIndex ? { ...value, text: translated, originalText: original } : value,
    )
    this.#replaceAt(index, { ...bubble, segments })
    return true
  }
  recentAssistantMessages(n: number = 3): string[] {
    const result: string[] = []
    for (let i = this.bubbles.length - 1; i >= 0 && result.length < n; i--) {
      const b = this.bubbles[i]
      if (b?.kind === "message") {
        result.unshift(b.segments.map((s) => s.text).join(""))
      }
    }
    return result
  }
  #displaySnapshot = $state<Bubble[] | null>(null)
  get bubbles(): Bubble[] {
    return this.#content.bubbles
  }
  get renderBubbles(): Bubble[] {
    return this.#displaySnapshot ?? this.bubbles
  }
  get isReconnectReplay(): boolean {
    return this.#displaySnapshot !== null
  }

  replace(next: Bubble[]): void {
    this.#content = { bubbles: next }
    this.#processingTarget = {} as TranscriptProcessingTarget
  }
  freezeDisplay(): void {
    this.#displaySnapshot ??= this.bubbles
  }
  releaseDisplay(): void {
    this.#displaySnapshot = null
  }
  appendContent(
    messageId: string | null,
    content: AppendContent,
    creation: AppendCreation | undefined,
  ): void {
    const next = reduceTranscriptAppend(this.bubbles, messageId, content, creation)
    const last = this.bubbles.at(-1)
    const appended = next.at(-1)
    // Preserve live array/bubble aliases, including a frozen display reference.
    if (next.length > this.bubbles.length && appended) this.append(appended)
    else if (last?.kind === "user" && appended?.kind === "user") {
      if (content.kind === "image") last.attachments = appended.attachments
      else last.contentPlaceholders = appended.contentPlaceholders
    } else if (last?.kind === "message" && appended?.kind === "message") {
      last.contentPlaceholders = appended.contentPlaceholders
    }
  }
  append(bubble: Bubble): void {
    this.bubbles.push(bubble)
  }
  #replaceAt(index: number, bubble: Bubble): void {
    this.bubbles[index] = bubble
  }
  applyPatches(patches: Patch[], resetOrigin?: "same-session-reconnect"): void {
    // A reset changes content identity while preserving the adapter's original array mutation.
    for (const patch of patches) {
      if (patch.op === "reset") {
        this.#content = { bubbles: this.bubbles }
        if (resetOrigin !== "same-session-reconnect") {
          this.#processingTarget = {} as TranscriptProcessingTarget
        }
      }
      applyPatchMutable(this.bubbles, [patch], { mapToolContent, mapLocations })
    }
  }
  #applySubagentEvents(parentId: string, events: readonly ClaudeSubagentEvent[]): boolean {
    const index = this.bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
    )
    let task = this.bubbles[index]
    if (!task || task.kind !== "tool") return false
    for (const event of events) task = reduceSubagent(task, event, Date.now())
    this.#replaceAt(index, task)
    return true
  }
  adoptUserMessageId(messageId: string | null): void {
    if (messageId === null) return
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bubble = this.bubbles[i]
      if (
        bubble !== undefined &&
        bubble.kind === "user" &&
        (bubble.messageId === messageId || bubble.messageId === null)
      ) {
        if (bubble.messageId === null) bubble.messageId = messageId
        break
      }
    }
  }
  hasTool(parentId: string): boolean {
    return this.bubbles.some((b) => b.kind === "tool" && b.toolCall.toolCallId === parentId)
  }
  hasNestedTool(parentId: string, childId: string): boolean {
    const parent = this.bubbles.find((b) => b.kind === "tool" && b.toolCall.toolCallId === parentId)
    return (
      parent?.kind === "tool" &&
      (parent.subFrames ?? []).some(
        (child) => child.kind === "tool" && child.toolCall.toolCallId === childId,
      )
    )
  }
  appendNestedTool(parentId: string, child: ToolBubble): boolean {
    const index = this.bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
    )
    const parent = this.bubbles[index]
    if (!parent || parent.kind !== "tool") return false
    this.#replaceAt(index, { ...parent, subFrames: [...(parent.subFrames ?? []), child] })
    return true
  }
  updateNestedTool(parentId: string, childId: string, patch: Partial<ToolCall>): void {
    const index = this.bubbles.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === parentId,
    )
    const parent = this.bubbles[index]
    if (!parent || parent.kind !== "tool") return
    const subFrames = parent.subFrames ?? []
    const childIndex = subFrames.findIndex(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === childId,
    )
    const child = subFrames[childIndex]
    if (!child || child.kind !== "tool") return
    const next = [...subFrames]
    next[childIndex] = { ...child, toolCall: { ...child.toolCall, ...patch } }
    this.#replaceAt(index, { ...parent, subFrames: next })
  }
}
