/**
 * reduce.ts — טהור. מקבל update גולמי (notification.update), מחזיר state חדש + patches.
 *
 * אסור לזרוק — update לא-תקין → {state, []} (no-op).
 * אפס IO, אפס browser globals, אפס Date.now() / crypto — ids מ-next*Seq.
 * דפוס: reducePlan (plan.ts) — הקשחה, לא חריגה.
 *
 * ─── slice session-state-reducer C1 (TDD) ───
 */
import type { SessionState, SessionMessage, SessionSegment, SessionToolCall, Patch } from "./types"

// ─── internal helpers ───

/** מקצה id לhודעה דטרמיניסטי: m_<seq> */
function nextMsgId(seq: number): string {
  return `m_${seq}`
}

/** מקצה id לsegment דטרמיניסטי: s_<seq> */
function nextSegId(seq: number): string {
  return `s_${seq}`
}

/** המרה בטוחה ל-string|null — undefined → null */
function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null
}

// ─── אסטרטגיית קיבוץ (מ-#appendChunk) ───

/**
 * canGroup — ניתן לקבץ chunk חדש לbubble האחרונה?
 * שכפול מדויק של הלוגיקה ב-#appendChunk:
 *   canGroup = last !== undefined && last.kind === kind
 *              && (messageId !== null ? last.messageId === messageId : last.messageId === null)
 * (kind: "user"|"thought"|"assistant")
 */
function canGroupWith(
  last: SessionMessage | undefined,
  role: "user" | "thought" | "assistant",
  messageId: string | null,
): last is SessionMessage & { role: "user" | "thought" | "assistant" } {
  if (last === undefined) return false
  if (last.role === "tool") return false
  if (last.role !== role) return false
  if (messageId !== null) {
    return last.messageId === messageId
  } else {
    return last.messageId === null
  }
}

// ─── handlers לסוגי updates ───

function handleTextChunk(
  state: SessionState,
  role: "user" | "thought" | "assistant",
  text: string,
  messageId: string | null,
): { state: SessionState; patches: Patch[] } {
  if (!text) return { state, patches: [] }

  const last = state.messages[state.messages.length - 1]
  const newVersion = state.version + 1

  if (canGroupWith(last, role, messageId)) {
    // append-segment
    const seg: SessionSegment = { id: nextSegId(state.nextSegmentSeq), text }
    const patch: Patch = {
      version: newVersion,
      op: "append-segment",
      targetId: last.id,
      segment: seg,
    }
    // update state immutably
    const updatedMsg: SessionMessage = {
      ...last,
      segments: [...last.segments, seg],
    }
    const messages = [...state.messages]
    messages[messages.length - 1] = updatedMsg
    return {
      state: {
        ...state,
        version: newVersion,
        messages,
        nextSegmentSeq: state.nextSegmentSeq + 1,
      },
      patches: [patch],
    }
  } else {
    // add-message
    const msgId = nextMsgId(state.nextMessageSeq)
    const segId = nextSegId(state.nextSegmentSeq)
    const seg: SessionSegment = { id: segId, text }
    const msg: SessionMessage = {
      id: msgId,
      role,
      messageId,
      segments: [seg],
    }
    const patch: Patch = { version: newVersion, op: "add-message", message: msg }
    return {
      state: {
        ...state,
        version: newVersion,
        messages: [...state.messages, msg],
        nextMessageSeq: state.nextMessageSeq + 1,
        nextSegmentSeq: state.nextSegmentSeq + 1,
      },
      patches: [patch],
    }
  }
}

function handleToolCall(
  state: SessionState,
  update: Record<string, unknown>,
): { state: SessionState; patches: Patch[] } {
  const toolCallId = update.toolCallId
  if (typeof toolCallId !== "string") return { state, patches: [] }

  const name =
    typeof update.kind === "string"
      ? update.kind
      : typeof update.title === "string"
        ? update.title
        : "tool"

  const toolCall: SessionToolCall = {
    toolCallId,
    name,
    kind: typeof update.kind === "string" ? update.kind : undefined,
    args: update.rawInput ?? {},
    status:
      update.status === "pending" ||
      update.status === "in_progress" ||
      update.status === "completed" ||
      update.status === "failed"
        ? update.status
        : "pending",
    title: typeof update.title === "string" ? update.title : undefined,
    result: update.rawOutput,
    content:
      Array.isArray(update.content) && update.content !== null ? update.content : undefined,
    locations:
      Array.isArray(update.locations) && update.locations !== null ? update.locations : undefined,
  }

  const msgId = nextMsgId(state.nextMessageSeq)
  const msg: SessionMessage = {
    id: msgId,
    role: "tool",
    messageId: null,
    toolCall,
  }

  const newVersion = state.version + 1
  const patch: Patch = { version: newVersion, op: "add-message", message: msg }

  return {
    state: {
      ...state,
      version: newVersion,
      messages: [...state.messages, msg],
      nextMessageSeq: state.nextMessageSeq + 1,
    },
    patches: [patch],
  }
}

function handleToolCallUpdate(
  state: SessionState,
  update: Record<string, unknown>,
): { state: SessionState; patches: Patch[] } {
  const toolCallId = update.toolCallId
  if (typeof toolCallId !== "string") return { state, patches: [] }

  const idx = state.messages.findIndex(
    (m) => m.role === "tool" && m.toolCall.toolCallId === toolCallId,
  )
  if (idx === -1) return { state, patches: [] }

  const old = state.messages[idx] as SessionMessage & { role: "tool" }

  // Build partial toolCall (only provided fields)
  const partial: Partial<SessionToolCall> = {}
  if (update.status !== undefined) {
    if (
      update.status === "pending" ||
      update.status === "in_progress" ||
      update.status === "completed" ||
      update.status === "failed"
    ) {
      partial.status = update.status
    }
  }
  if (update.rawInput !== undefined) partial.args = update.rawInput
  if (update.rawOutput !== undefined) partial.result = update.rawOutput
  if (typeof update.kind === "string") partial.kind = update.kind
  if (typeof update.title === "string") partial.title = update.title
  if (update.content !== undefined) {
    partial.content = update.content === null ? undefined : Array.isArray(update.content) ? update.content : undefined
  }
  if (update.locations !== undefined) {
    partial.locations = update.locations === null ? undefined : Array.isArray(update.locations) ? update.locations : undefined
  }

  const newToolCall: SessionToolCall = { ...old.toolCall, ...partial }
  const updatedMsg: SessionMessage = { ...old, toolCall: newToolCall }

  const messages = [...state.messages]
  messages[idx] = updatedMsg

  const newVersion = state.version + 1
  const patch: Patch = {
    version: newVersion,
    op: "update-tool",
    targetId: old.id,
    toolCall: partial,
  }

  return {
    state: { ...state, version: newVersion, messages },
    patches: [patch],
  }
}

// ─── main reduce ───

/**
 * reduce — טהור. מקבל update גולמי (הצורה של notification.update), מחזיר state חדש + patches.
 * אסור לזרוק — update לא-תקין / חסר-שדות → {state, []} (no-op).
 */
export function reduce(
  state: SessionState,
  ev: unknown,
): { state: SessionState; patches: Patch[] } {
  if (typeof ev !== "object" || ev === null) return { state, patches: [] }
  const u = ev as Record<string, unknown>
  const sessionUpdate = u.sessionUpdate

  if (typeof sessionUpdate !== "string") return { state, patches: [] }

  // text chunks
  if (
    sessionUpdate === "agent_message_chunk" ||
    sessionUpdate === "agent_thought_chunk" ||
    sessionUpdate === "user_message_chunk"
  ) {
    const content = u.content as Record<string, unknown> | undefined
    if (content?.type !== "text") return { state, patches: [] }
    const text = typeof content.text === "string" ? content.text : ""
    const messageId = toStringOrNull(u.messageId)
    const role: "user" | "thought" | "assistant" =
      sessionUpdate === "user_message_chunk"
        ? "user"
        : sessionUpdate === "agent_thought_chunk"
          ? "thought"
          : "assistant"
    return handleTextChunk(state, role, text, messageId)
  }

  // tool
  if (sessionUpdate === "tool_call") {
    return handleToolCall(state, u)
  }
  if (sessionUpdate === "tool_call_update") {
    return handleToolCallUpdate(state, u)
  }

  // everything else (plan, usage_update, current_mode_update, etc.) → no-op
  // (ה-VM ממשיך לטפל בהם ישירות)
  return { state, patches: [] }
}
