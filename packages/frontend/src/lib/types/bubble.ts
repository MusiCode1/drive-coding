/**
 * Bubble model — shared between view-models, components and Speaker.
 *
 * Discriminated union by `kind`. Each variant carries exactly the fields it
 * needs; consumers that don't need a field simply don't access it. See
 * `packages/frontend/docs/bubble-model.md` for the rationale.
 *
 * In slice 2 we use `user`, `message`, `thought`. `tool` is declared now so
 * later slices can light it up without another atomic refactor (golden rule
 * #5: no "backward compat in place").
 */

export type Segment = {
  id: string
  text: string
}

export type ThoughtSegment = Segment & {
  /** Original (untranslated) text — populated by Speaker after Hebrew translation. */
  originalText?: string
}

export type BubbleBase = {
  id: string
  /** ACP message id — null for synthetic bubbles (user prompts, tool calls). */
  messageId: string | null
  createdAt: number
}

export type UserBubble = BubbleBase & {
  kind: "user"
  /**
   * Live prompts (sendPrompt): always null — synthetic optimistic bubble.
   * History replay (loadSession → user_message_chunk): ACP messageId, used to
   * group consecutive chunks of the same historic user message into one bubble.
   */
  messageId: string | null
  segments: Segment[]
  /** Slice 10 — id in the BE RecordingsStore for replay. */
  recordingId?: string
}

export type MessageBubble = BubbleBase & {
  kind: "message"
  segments: Segment[]
}

export type ThoughtBubble = BubbleBase & {
  kind: "thought"
  segments: ThoughtSegment[]
}

export type ToolContentText = { type: "text"; text: string }
export type ToolContentDiff = { type: "diff"; path: string; oldText?: string; newText: string }
export type ToolContentTerminal = { type: "terminal"; terminalId: string }
export type ToolContentOther = { type: "other"; raw: unknown } // image/audio/resource/unknown
export type ToolContent = ToolContentText | ToolContentDiff | ToolContentTerminal | ToolContentOther

export type ToolLocation = { path: string; line?: number }

export type ToolCall = {
  toolCallId: string
  name: string
  args: unknown
  status: "pending" | "in_progress" | "completed" | "failed"
  /** ACP raw title (technical). */
  title?: string
  /** Gemini-generated prose (Hebrew). */
  narration?: string
  /** ACP ToolKind: read/edit/delete/move/search/execute/think/fetch/switch_mode/other */
  kind?: string
  /** Raw output returned by the tool (from ACP rawOutput). */
  result?: unknown
  // ─── slice 16 (ACP content) ───
  content?: ToolContent[]
  locations?: ToolLocation[]
}

export type ToolBubble = BubbleBase & {
  kind: "tool"
  messageId: null
  toolCall: ToolCall
  /** Always empty — keeps the shape uniform with content bubbles for the union. */
  segments: never[]
}

export type Bubble = UserBubble | MessageBubble | ThoughtBubble | ToolBubble
