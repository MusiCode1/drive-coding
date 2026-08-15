/**
 * reduce.ts — טהור. מקבל update גולמי (notification.update), מחזיר state חדש + patches.
 *
 * אסור לזרוק — update לא-תקין → {state, []} (no-op).
 * אפס IO, אפס browser globals, אפס Date.now() / crypto — ids מ-next*Seq.
 * דפוס: reducePlan (plan.ts) — הקשחה, לא חריגה.
 *
 * ─── slice session-state-reducer C1 (TDD) ───
 */
import type {
  Patch,
  SessionMessage,
  SessionModes,
  SessionSegment,
  SessionState,
  SessionToolCall,
  SessionUsage,
} from "./types"

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

  // C1: derive turnState from content role (user_message_chunk = replay, no change)
  const newTurnState =
    role === "thought" ? "thinking" : role === "assistant" ? "responding" : state.turnState

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
        turnState: newTurnState,
      },
      patches: [patch],
    }
  } else {
    // ─── מיזוג dev → שרשרת ה-HTTP ───
    // dev תיקן זאת ב-4506229 בתוך AgentSession.#appendChunk, מתודה שהשרשרת
    // הסירה. הבאג עצמו נשאר: `!text` למעלה מסנן מחרוזת ריקה בלבד, ומחרוזת
    // של רווחים היא truthy — ולכן מקטע-רווחים שאי-אפשר לקבץ היה פותח בועה
    // ריקה חדשה. כאן זה גם נכון יותר מהמקור: התיקון יושב ב-core ולכן חל
    // על שני המסלולים, לא רק על ה-FE.
    if (text.trim() === "") return { state, patches: [] }

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
        turnState: newTurnState,
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

  // ─── מיזוג dev → שרשרת ה-HTTP ───
  // dev תיקן זאת ב-cb1021a ("מניעת כפילויות מפתחות ב-Virtualizer"). ספק ששולח
  // `tool_call` פעמיים עם אותו toolCallId — במקום tool_call_update — היה יוצר
  // בועה שנייה, ואיתה **מפתח כפול** ב-Virtualizer. השרשרת החליפה את המימוש
  // ב-FE ולכן התיקון לא עבר. כאן הוא יושב ב-core ⇒ חל על שני המסלולים.
  const existingIdx = state.messages.findIndex(
    (m) => m.role === "tool" && m.toolCall.toolCallId === toolCallId,
  )
  if (existingIdx !== -1) return handleToolCallUpdate(state, update)

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
    content: Array.isArray(update.content) && update.content !== null ? update.content : undefined,
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
      turnState: "calling-tool", // C1: tool_call → 'calling-tool'
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
    partial.content =
      update.content === null
        ? undefined
        : Array.isArray(update.content)
          ? update.content
          : undefined
  }
  if (update.locations !== undefined) {
    partial.locations =
      update.locations === null
        ? undefined
        : Array.isArray(update.locations)
          ? update.locations
          : undefined
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

  // ─── C1: metadata handlers ───

  // session_info_update → update title
  if (sessionUpdate === "session_info_update") {
    const title = u.title
    if (title === undefined) return { state, patches: [] } // keep-on-undefined
    const newTitle = title === null ? "" : typeof title === "string" ? title : state.title
    if (newTitle === state.title && title !== null) return { state, patches: [] }
    const newVersion = state.version + 1
    const newState: SessionState = { ...state, version: newVersion, title: newTitle }
    const patch: Patch = { version: newVersion, op: "update-session", changes: { title: newTitle } }
    return { state: newState, patches: [patch] }
  }

  // available_commands_update → update commands
  if (sessionUpdate === "available_commands_update") {
    const cmds = Array.isArray(u.availableCommands) ? u.availableCommands : []
    const newVersion = state.version + 1
    const newState: SessionState = { ...state, version: newVersion, commands: cmds }
    const patch: Patch = { version: newVersion, op: "update-session", changes: { commands: cmds } }
    return { state: newState, patches: [patch] }
  }

  // current_mode_update → update modes.currentModeId (preserve availableModes)
  if (sessionUpdate === "current_mode_update") {
    const modeId = u.currentModeId
    if (typeof modeId !== "string") return { state, patches: [] }
    const newModes: NonNullable<SessionModes> = {
      availableModes: state.modes?.availableModes ?? [],
      currentModeId: modeId,
    }
    const newVersion = state.version + 1
    const newState: SessionState = { ...state, version: newVersion, modes: newModes }
    const patch: Patch = { version: newVersion, op: "update-session", changes: { modes: newModes } }
    return { state: newState, patches: [patch] }
  }

  // config_option_update → update configOptions
  if (sessionUpdate === "config_option_update") {
    const opts = Array.isArray(u.configOptions) ? u.configOptions : []
    const newVersion = state.version + 1
    const newState: SessionState = { ...state, version: newVersion, configOptions: opts }
    const patch: Patch = {
      version: newVersion,
      op: "update-session",
      changes: { configOptions: opts },
    }
    return { state: newState, patches: [patch] }
  }

  // usage_update → update contextUsage (anti-flicker: preserve previous cost)
  if (sessionUpdate === "usage_update") {
    const uu = u as { used?: unknown; size?: unknown; cost?: unknown }
    if (typeof uu.used !== "number" || typeof uu.size !== "number") return { state, patches: [] }
    const newUsage: SessionUsage = {
      used: uu.used,
      size: uu.size,
      cost: typeof uu.cost === "number" ? uu.cost : state.contextUsage?.cost,
    }
    const newVersion = state.version + 1
    const newState: SessionState = { ...state, version: newVersion, contextUsage: newUsage }
    const patch: Patch = {
      version: newVersion,
      op: "update-session",
      changes: { contextUsage: newUsage },
    }
    return { state: newState, patches: [patch] }
  }

  // plan → no-op (handled in VM)
  return { state, patches: [] }
}
