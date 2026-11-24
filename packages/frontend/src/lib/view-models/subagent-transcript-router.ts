import type { SessionState } from "@drive-coding/core/session"
import type { Bubble, ToolBubble } from "$lib/types/bubble"
import {
  type ClaudeSubagentEvent,
  createSubagentIndex,
  parseClaudeSdkMessage,
  reduceSubagent,
} from "./claude-subagent-parse"
import { isSubagentToolCall } from "./subagent-tool-identity"

const SUBAGENT_PENDING_CAP = 50

export type SubagentTranscriptDeps = {
  bubbles: () => Bubble[]
  sessionState: () => SessionState
}

function toolMetaForBubble(
  deps: SubagentTranscriptDeps,
  task: ToolBubble,
): Record<string, unknown> | undefined {
  return deps
    .sessionState()
    .messages.find((m) => m.role === "tool" && m.toolCall.toolCallId === task.toolCall.toolCallId)
    ?.meta
}

/** ניתוב `_claude/sdkMessage` לבועת ה-Task האב — רק לקריאת Agent/Task (שער-זהות). */
export class SubagentTranscriptRouter {
  readonly #deps: SubagentTranscriptDeps
  #subagentIndex = createSubagentIndex()
  #pendingByParent: { parentId: string; event: ClaudeSubagentEvent }[] = []

  constructor(deps: SubagentTranscriptDeps) {
    this.#deps = deps
  }

  /** params של `_claude/sdkMessage`. parse → resolve → gate → reduceSubagent, או buffer. */
  onSdkMessage(params: Record<string, unknown>): void {
    const ev = parseClaudeSdkMessage(params)
    if (ev.kind === "ignored") return
    const parentId = this.#subagentIndex.resolve(ev)
    if (parentId === undefined) return
    const bubbles = this.#deps.bubbles()
    const idx = bubbles.findIndex((b) => b.kind === "tool" && b.toolCall.toolCallId === parentId)
    if (idx === -1) {
      this.#pushPendingSubagentEvent(parentId, ev)
      return
    }
    const task = bubbles[idx]
    if (task?.kind !== "tool") return
    const meta = toolMetaForBubble(this.#deps, task)
    if (!isSubagentToolCall(task.toolCall.kind, meta)) return
    bubbles[idx] = reduceSubagent(task, ev)
  }

  /** מחיל אירועים שהמתינו ל-toolCallId הזה. נקרא מ-#applyToolCall. */
  flush(toolCallId: string): void {
    if (this.#pendingByParent.length === 0) return
    const matching = this.#pendingByParent.filter((p) => p.parentId === toolCallId)
    if (matching.length === 0) return
    this.#pendingByParent = this.#pendingByParent.filter((p) => p.parentId !== toolCallId)
    const bubbles = this.#deps.bubbles()
    const idx = bubbles.findIndex((b) => b.kind === "tool" && b.toolCall.toolCallId === toolCallId)
    if (idx === -1) return
    let task = bubbles[idx]
    if (task?.kind !== "tool") return
    const meta = toolMetaForBubble(this.#deps, task)
    if (!isSubagentToolCall(task.toolCall.kind, meta)) return
    for (const { event } of matching) {
      task = reduceSubagent(task, event)
    }
    bubbles[idx] = task
  }

  #pushPendingSubagentEvent(parentId: string, event: ClaudeSubagentEvent): void {
    this.#pendingByParent.push({ parentId, event })
    if (this.#pendingByParent.length > SUBAGENT_PENDING_CAP) {
      this.#pendingByParent.shift()
    }
  }
}
