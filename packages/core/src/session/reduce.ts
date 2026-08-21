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
  TurnStateValue,
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
  // ─── slice acp-v2-reduce: שינוי-סמנטיקה מכוון ───
  // 🔴 כאן היה `return { state, patches: [] }` — כלומר עדכון לכלי שטרם נוצר
  // **נזרק בשקט**, וכלי שהספק דיווח עליו פשוט לא הופיע.
  //
  // ב-ACP v2 אין `tool_call` כלל: ה-`tool_call_update` הראשון הוא שיוצר.
  // ⇒ הענף הזה אינו רק "עמידות" אלא **הסמנטיקה הנכונה של הפרוטוקול**.
  // וגם ב-v1 הוא נכון יותר: ספק ששולח update לפני create הוא מקרה-קצה
  // מוכר, וזריקה שקטה היא אותה מחלקת-כשל של ה-gate שהעלים תמונה.
  //
  // ⚠️ אין כאן רקורסיה אינסופית: `handleToolCall` מנתב חזרה לכאן רק כשהוא
  // **מצא** את הכלי, וכאן מנתבים אליו רק כשלא נמצא. כל מסלול צועד פעם אחת.
  if (idx === -1) return handleToolCall(state, update)

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

// ─── ACP v2 handlers ─────────────────────────────────────────────────────────
//
// ⚠️ הכל כאן **תוספתי**. ה-CLI-ים בשטח מדברים v1 וימשיכו לדבר v1; מה שמפעיל
// את הענפים האלה הוא **החוט הפנימי שלנו** אחרי צעד 3, שבו ה-BE פולט
// `session/update` בצורת-v2 אל ה-FE.

/** ContentBlock[] → {טקסט מצטבר, קבצים מצורפים}. אפס-זריקה: מה שאינו טקסט נשמר. */
function splitContentBlocks(blocks: unknown): {
  text: string
  attachments: { mimeType: string; dataBase64: string }[]
} {
  const attachments: { mimeType: string; dataBase64: string }[] = []
  let text = ""
  if (!Array.isArray(blocks)) return { text, attachments }
  for (const raw of blocks) {
    if (typeof raw !== "object" || raw === null) continue
    const b = raw as Record<string, unknown>
    if (b.type === "text" && typeof b.text === "string") {
      text += b.text
    } else if (b.type === "image" && typeof b.mimeType === "string" && typeof b.data === "string") {
      attachments.push({ mimeType: b.mimeType, dataBase64: b.data })
    }
  }
  return { text, attachments }
}

/**
 * upsert של הודעה שלמה — `agent_message` / `user_message` / `agent_thought`.
 *
 * זו היכולת ש-v1 חסר, ובלעדיה snapshot מכווץ אינו ניתן לביטוי בפרוטוקול.
 * ההתאמה היא לפי `messageId` של ACP; ה-Patch שיוצא כבר מדבר ב-id הסינתטי.
 */
function handleWholeMessage(
  state: SessionState,
  role: "user" | "thought" | "assistant",
  u: Record<string, unknown>,
): { state: SessionState; patches: Patch[] } {
  const messageId = typeof u.messageId === "string" ? u.messageId : null
  if (messageId === null) return { state, patches: [] }

  const { text, attachments } = splitContentBlocks(u.content)
  // הודעה בלי שום תוכן שמיש אינה בועה ריקה — היא לא-כלום.
  if (!text && attachments.length === 0) return { state, patches: [] }

  const idx = state.messages.findIndex((m) => m.role === role && m.messageId === messageId)
  const newVersion = state.version + 1
  const turnState: TurnStateValue =
    role === "thought" ? "thinking" : role === "assistant" ? "responding" : state.turnState

  // segment יחיד: ההודעה השלמה **היא** הכיווץ. פיצול-מחדש ל-chunks היה
  // ממציא גבולות שהספק מעולם לא שלח.
  const segments: SessionSegment[] = text ? [{ id: nextSegId(state.nextSegmentSeq), text }] : []
  const nextSegmentSeq = state.nextSegmentSeq + (text ? 1 : 0)

  if (idx === -1) {
    const msg: SessionMessage = {
      id: nextMsgId(state.nextMessageSeq),
      role,
      messageId,
      segments,
      ...(attachments.length > 0 ? { attachments } : {}),
    }
    return {
      state: {
        ...state,
        version: newVersion,
        messages: [...state.messages, msg],
        nextMessageSeq: state.nextMessageSeq + 1,
        nextSegmentSeq,
        turnState,
      },
      patches: [{ version: newVersion, op: "add-message", message: msg }],
    }
  }

  const old = state.messages[idx] as SessionMessage & { role: "user" | "thought" | "assistant" }
  const msg: SessionMessage = {
    ...old,
    segments,
    ...(attachments.length > 0 ? { attachments } : {}),
  }
  const messages = [...state.messages]
  messages[idx] = msg
  return {
    state: { ...state, version: newVersion, messages, nextSegmentSeq, turnState },
    patches: [{ version: newVersion, op: "set-message", targetId: old.id, message: msg }],
  }
}

/** מצבי-הריצה של v2 שהם "עדיין עובד" — ה-turnState שלנו עדין יותר מהם. */
const RUNNING_SUBSTATES: ReadonlySet<TurnStateValue> = new Set<TurnStateValue>([
  "waiting",
  "thinking",
  "responding",
  "calling-tool",
])

/**
 * `state_update` — מצב-התור, שב-v1 **אינו נתון שעובר בחוט כלל**.
 *
 * ⚠️ המיפוי אינו סימטרי, וזה מכוון: v2 מכיר שלושה מצבים, ואנחנו חמישה.
 * `running` הוא **רצפה ולא השמה** — אחרת `running` שמגיע באמצע תשובה היה
 * מחזיר את ה-UI מ"עונה" ל"ממתין".
 */
function handleStateUpdate(
  state: SessionState,
  u: Record<string, unknown>,
): { state: SessionState; patches: Patch[] } {
  const s = u.state

  if (s === "running" || s === "requires_action") {
    if (RUNNING_SUBSTATES.has(state.turnState)) return { state, patches: [] }
    const newVersion = state.version + 1
    return {
      state: { ...state, version: newVersion, turnState: "waiting" },
      patches: [{ version: newVersion, op: "update-session", changes: { turnState: "waiting" } }],
    }
  }

  if (s === "idle") {
    // stopReason רגיל = סיום תקין. כל שאר הערכים הם כשל שצריך להיראות —
    // ⇒ allowlist, לא denylist: ערך חדש שלא נכיר ייחשב כשל ולא ייבלע.
    const stopReason = typeof u.stopReason === "string" ? u.stopReason : undefined
    const clean =
      stopReason === undefined || stopReason === "end_turn" || stopReason === "cancelled"
    // ⚠️ **החותמת מגיעה מה-frame, לא מכאן.** הקובץ הזה מוצהר טהור בכותרתו
    // ("אפס Date.now()"), ולכן `reduce` אינו רשאי להמציא זמן — הקליפה היא
    // שמחזיקה שעון (`session-host.ts:691` מטביע `Date.now()` ב-applyTurnEnd).
    // ‏ACP שומר את `_meta` בדיוק לזה: *"attach additional metadata"*.
    // ‏0 = הפולט לא הטביע. ‏`.at` אינו מרונדר בשום מקום ב-FE (רק `.message`),
    // ולכן אפס-זריקה גובר: עדיף הודעה בלי זמן מאשר לבלוע את השגיאה.
    const meta = (typeof u._meta === "object" && u._meta !== null ? u._meta : {}) as Record<
      string,
      unknown
    >
    const at = typeof meta["_drive/at"] === "number" ? (meta["_drive/at"] as number) : 0
    const lastTurnError = clean ? null : { message: stopReason as string, at }
    const newVersion = state.version + 1
    return {
      state: { ...state, version: newVersion, turnState: "idle", lastTurnError },
      patches: [
        {
          version: newVersion,
          op: "update-session",
          changes: { turnState: "idle", lastTurnError },
        },
      ],
    }
  }

  // v2 שומר ערכי-state לא-מוכרים לווריאנטים עתידיים ⇒ לשאת, לא לזרוק.
  return opaquePatch(state, u)
}

/** `tool_call_content_chunk` — פריט-תוכן אחד מתווסף לכלי קיים. */
function handleToolContentChunk(
  state: SessionState,
  u: Record<string, unknown>,
): { state: SessionState; patches: Patch[] } {
  const toolCallId = u.toolCallId
  if (typeof toolCallId !== "string") return opaquePatch(state, u)
  const idx = state.messages.findIndex(
    (m) => m.role === "tool" && m.toolCall.toolCallId === toolCallId,
  )
  // כלי שאיננו — לשאת, לא לבלוע. הצרכן יחליט.
  if (idx === -1) return opaquePatch(state, u)

  const old = state.messages[idx] as SessionMessage & { role: "tool" }
  const content = [...(old.toolCall.content ?? []), u.content]
  const newVersion = state.version + 1
  const messages = [...state.messages]
  messages[idx] = { ...old, toolCall: { ...old.toolCall, content } }
  return {
    state: { ...state, version: newVersion, messages },
    patches: [{ version: newVersion, op: "update-tool", targetId: old.id, toolCall: { content } }],
  }
}

/** נושא update לא-מוכר כמות שהוא. מרוכז כאן כי ארבעה מסלולים צריכים אותו. */
function opaquePatch(state: SessionState, u: unknown): { state: SessionState; patches: Patch[] } {
  const newVersion = state.version + 1
  return {
    state: { ...state, version: newVersion },
    patches: [{ version: newVersion, op: "opaque", update: u }],
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

  // ─── ACP v2: upsert של הודעה שלמה ───
  if (
    sessionUpdate === "agent_message" ||
    sessionUpdate === "agent_thought" ||
    sessionUpdate === "user_message"
  ) {
    const role =
      sessionUpdate === "user_message"
        ? "user"
        : sessionUpdate === "agent_thought"
          ? "thought"
          : "assistant"
    return handleWholeMessage(state, role, u)
  }

  // ─── ACP v2: מצב-התור ───
  if (sessionUpdate === "state_update") {
    return handleStateUpdate(state, u)
  }

  // tool
  if (sessionUpdate === "tool_call") {
    return handleToolCall(state, u)
  }
  if (sessionUpdate === "tool_call_update") {
    return handleToolCallUpdate(state, u)
  }

  // ─── ACP v2: פריט-תוכן לכלי ───
  if (sessionUpdate === "tool_call_content_chunk") {
    return handleToolContentChunk(state, u)
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

  // 🔴 כאן היה `return { state, patches: [] }` — כלומר **כל מה שלא זוהה נזרק
  // בשקט**, ובכללו `plan`/`plan_update`/`plan_removed`. הם מטופלים ב-VM
  // (`reducePlan`), אבל רק בנתיב ה-updates הגולמיים = WS. ב-HTTP ה-FE מקבל
  // Patches ⇒ רשימת-המשימות של הסוכן **לא הייתה קיימת שם כלל**.
  //
  // עכשיו: מה שלא זוהה נישא הלאה כ-`opaque`, בסדר הנכון, בלי שהליבה תבין
  // אותו. הצרכן שכן מבין — מטפל. מי שלא — מתעלם.
  return opaquePatch(state, u)
}
