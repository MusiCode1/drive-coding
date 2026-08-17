/**
 * session/types.ts — SessionState / SessionMessage / Patch — pure types.
 *
 * מודל-המצב של שיחה: גרסה core בלבד, ללא IO, ללא browser globals.
 * ids דטרמיניסטיים: m_<seq> / s_<seq> — לעולם לא crypto.randomUUID (browser global + לא-דטרמיניסטי).
 *
 * ─── slice session-state-reducer C0 (TDD) ───
 * ─── slice session-view-port C1 (TDD): הרחבת SessionState + meta + helpers ───
 * ─── slice session-host-pending-surface C1 (TDD): +lastTurnError · pending/turn helpers ───
 */

import type {
  AvailableCommand,
  ContentBlock,
  SessionConfigOption,
  RequestPermissionRequest,
  CreateElicitationRequest,
} from "@agentclientprotocol/sdk"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"

// ─── Re-exports from ACP SDK (used in SessionState fields) ───
export type { AvailableCommand, SessionConfigOption }
// ─── Re-export from provider (used in SessionState.quota) ───
export type { QuotaSnapshot }

// ─── Session lifecycle status ───

export type SessionStatus = "idle" | "connecting" | "connected" | "error" | "disconnected"

// ─── Turn state — what the model is doing in the current turn ───

export type TurnStateValue = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"

// ─── Pending requests (bridged from AcpClient callbacks to state) ───

export type PendingPermission = {
  requestId: number
  /** RequestPermissionRequest from ACP SDK — opaque to core consumers */
  params: RequestPermissionRequest
}

export type PendingElicitation = {
  requestId: number
  /** CreateElicitationRequest from ACP SDK — opaque to core consumers */
  params: CreateElicitationRequest
}

// ─── Session capabilities ───

export type SessionCapabilities = {
  mcp: boolean
  compact: boolean
  commands: boolean
  usage: boolean
  configOptions: boolean
  rename: boolean
  thinkingTokens: boolean
  image: boolean
}

// ─── Session modes ───

export type SessionModes = {
  /** SessionMode[] from ACP SDK — opaque to core (not inspected here) */
  availableModes: unknown[]
  currentModeId: string
} | null

// ─── Session usage (context window utilization) ───

export type SessionUsage = {
  used: number
  size: number
  cost?: number
}

// ─── Roles ───

export type SessionRole = "user" | "thought" | "assistant" | "tool"

// ─���─ Segments ───

export type SessionSegment = {
  id: string
  text: string
}

// ─── Tool call ───

export type SessionToolCall = {
  toolCallId: string
  /** שם הכלי: kind ?? title ?? "tool" */
  name: string
  kind?: string
  args: unknown
  status: "pending" | "in_progress" | "completed" | "failed"
  title?: string
  result?: unknown
  /** raw content — מיפוי ל-ToolContent[] נעשה ב-FE */
  content?: unknown[]
  locations?: unknown[]
}

// ─── Messages ───

/**
 * SessionMessage — discriminated union לפי role.
 * - user / thought / assistant: נושאים segments
 * - tool: נושא toolCall; messageId תמיד null (ToolBubble לא שייך ל-ACP messageId)
 *
 * שדה `id` = m_<seq> (דטרמיניסטי).
 * שדה `messageId` = מזהה-הספק של ACP (string | null) — משמש ל-grouping, לא ל-identity.
 * שדה `meta` — תיק אטום אופציונלי; core לא מפרש את תוכנו. נדרש ל-meta passthrough (§9).
 */
export type SessionMessage =
  | {
      id: string
      role: "user" | "thought" | "assistant"
      messageId: string | null
      segments: SessionSegment[]
      meta?: Record<string, unknown>
      /** slice remote-images C2 — תמונות שנשלחו עם הפרומפט. אופציונלי ו-additive. */
      attachments?: { mimeType: string; dataBase64: string }[]
    }
  | {
      id: string
      role: "tool"
      messageId: null
      toolCall: SessionToolCall
      meta?: Record<string, unknown>
    }

// ��── State ───

export type SessionState = {
  /** מונה-על; כל reduce / applyPatch מעלה ב-1 */
  version: number
  sessionId: string | null
  messages: SessionMessage[]
  /** מונה דטרמיניסטי ל-ids של messages (m_<n>) */
  nextMessageSeq: number
  /** מונה דטרמיניסטי ל-ids של segments (s_<n>) */
  nextSegmentSeq: number

  // ─── C1: session lifecycle + metadata fields ───

  /** סטטוס חיבור הסשן. */
  status: SessionStatus
  /** מה המודל עושה בתור הנוכחי — נגזר מ-wire events ב-reduce. */
  turnState: TurnStateValue
  /** בקשות ממתינות שהגיעו מה-Agent (permission / elicitation). */
  pending: {
    permission: PendingPermission | null
    elicitation: PendingElicitation | null
  }
  /** יכולות הסשן מ-_drive/capabilities (NormalizedCapabilities). null = טרם התקבל. */
  capabilities: SessionCapabilities | null
  /** מצב ה-modes הזמינים + הנוכחי. null = טרם קיבלנו מידע. */
  modes: SessionModes
  /** אפשרויות config של הסשן הפתוח. */
  configOptions: SessionConfigOption[]
  /**
   * ניצול חלון-הקונטקסט + עלות מ-usage_update (wire-driven).
   * null = טרם התקבל update בסשן הנוכחי.
   */
  contextUsage: SessionUsage | null
  /**
   * Snapshot מכסה גנרי מ-_drive/getQuota (fetch-driven, לא wire).
   * LocalSessionView קורא refreshQuota() ומעדכן שדה זה.
   */
  quota: QuotaSnapshot | null
  /** כותרת הסשן. "" = אין כותרת (סשן חדש) או null מה-wire. */
  title: string
  /** פקודות slash שהספק חשף (available_commands_update). */
  commands: AvailableCommand[]
  /**
   * שגיאת התור האחרון. null = התור האחרון הצליח / בוטל / טרם היה תור.
   * ─── slice session-host-pending-surface C1 ───
   */
  lastTurnError: { message: string; at: number } | null
}

// ─── Patches ───

/**
 * Patch — פורמט ממוקד-מטרה, תומך בהחלה מוטבילית (§8.3, FE reactivity).
 *
 * ⚠️ targetId נושא את ה-id הסינתטי (m_<seq>), לא את messageId של ACP.
 * אביגיל #3: ToolBubble.messageId תמיד null — התאמה על targetId בלבד מונחת.
 *
 * update-session (C1): עדכון שדות מטא-מידע (title, commands, modes, configOptions,
 * contextUsage, status, turnState, pending, capabilities, quota).
 */
export type Patch =
  /**
   * 🔴 עדכון שהשרת **לא מבין** — נישא כמות שהוא, בסדר הנכון, ולא נמחק.
   *
   * הרקע: `reduce()` הסתיים ב-`return { state, patches: [] }`, כלומר **כל מה
   * שלא זוהה נזרק בשקט**. הקורבן שנתפס: `plan`/`plan_update`/`plan_removed`
   * (רשימת-המשימות של הסוכן) מטופלים רק ב-VM, בנתיב ה-updates הגולמיים =
   * WS בלבד. ב-HTTP ה-FE מקבל Patches ⇒ **רשימת-המשימות לא קיימת שם כלל.**
   *
   * ⚠️ אותה מחלקת-כשל של ה-gate `if (!text) return` שזרק 4 מ-5 ContentBlocks
   * והעלים תמונה בטעינה-מחדש. הדפוס: *"לא מבין"* הפך ל*"זורק"*.
   *
   * העיקרון: **להבין מעט, לשאת הכל.** ה-BE מנרמל את המעטפה (זהות · סדר ·
   * מצב · מי-חייב-תשובה) ואינו מפרש את התוכן — אבל "לא מפרש" ≠ "לא נושא".
   * ⇒ פיצ'ר חדש ב-CLI מגיע ל-FE **באפס עבודת-BE**, בדיוק כמו בצינור השקוף.
   */
  | { version: number; op: "opaque"; update: unknown }
  | { version: number; op: "append-segment"; targetId: string; segment: SessionSegment }
  | { version: number; op: "add-message"; message: SessionMessage }
  | { version: number; op: "update-tool"; targetId: string; toolCall: Partial<SessionToolCall> }
  | {
      version: number
      op: "reset"
      messages: SessionMessage[]
      nextMessageSeq: number
      nextSegmentSeq: number
    }
  | {
      version: number
      op: "update-session"
      changes: Partial<
        Pick<
          SessionState,
          | "title"
          | "commands"
          | "modes"
          | "configOptions"
          | "contextUsage"
          | "status"
          | "turnState"
          | "pending"
          | "capabilities"
          | "quota"
          | "lastTurnError"
        >
      >
    }

// ─── Helpers ───

/** יוצר SessionState ריק עם sessionId נתון + ברירות-מחדל לכל השדות (כולל C1). */
export function createInitialSessionState({ sessionId }: { sessionId: string | null }): SessionState {
  return {
    version: 0,
    sessionId,
    messages: [],
    nextMessageSeq: 0,
    nextSegmentSeq: 0,
    // C1 fields
    status: "idle",
    turnState: "idle",
    pending: { permission: null, elicitation: null },
    capabilities: null,
    modes: null,
    configOptions: [],
    contextUsage: null,
    quota: null,
    title: "",
    commands: [],
    lastTurnError: null,
  }
}

/** קבוע נוחות — state ריק. */
export const INITIAL_SESSION_STATE: SessionState = createInitialSessionState({ sessionId: null })

// ─── C1: User message helpers ───

/**
 * synthesizeUserMessage — בונה SessionMessage עם role=user, תוכן טקסטואלי,
 * ו-meta אופציונלי. משתמש ב-state.nextMessageSeq/nextSegmentSeq לids דטרמיניסטיים.
 * אינו מעדכן את ה-state — יש לקרוא ל-applyUserMessage אחריו.
 */
export function synthesizeUserMessage(
  state: SessionState,
  content: string | ContentBlock[],
  meta?: Record<string, unknown>,
): SessionMessage {
  const msgId = `m_${state.nextMessageSeq}`
  const segId = `s_${state.nextSegmentSeq}`

  if (typeof content === "string") {
    return {
      id: msgId,
      role: "user",
      messageId: null,
      segments: [{ id: segId, text: content }],
      ...(meta !== undefined && { meta }),
    }
  }

  // PromptBlocks: text blocks → segments, image blocks → attachments
  const textBlocks = content.filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
  const imageBlocks = content.filter(
    (b): b is ContentBlock & { type: "image"; data: string; mimeType: string } => b.type === "image",
  )
  const segments = textBlocks.map((b, i) => ({ id: `${segId}_${i}`, text: b.text }))
  const attachments = imageBlocks.map((b) => ({ mimeType: b.mimeType, dataBase64: b.data }))

  return {
    id: msgId,
    role: "user",
    messageId: null,
    segments,
    ...(attachments.length > 0 && { attachments }),
    ...(meta !== undefined && { meta }),
  }
}

/**
 * applyUserMessage — מחיל add-message patch על state (immutable).
 * מחזיר { state: SessionState; patches: Patch[] } — אותה צורה כמו reduce.
 * נועד ל-S3 (meta passthrough): synthesizeUserMessage → applyUserMessage → LocalSessionView.prompt().
 */
export function applyUserMessage(
  state: SessionState,
  msg: SessionMessage,
): { state: SessionState; patches: Patch[] } {
  const newVersion = state.version + 1
  const patch: Patch = { version: newVersion, op: "add-message", message: msg }
  let nextSegSeq = state.nextSegmentSeq
  if (msg.role !== "tool") {
    nextSegSeq += msg.segments.length
  }
  return {
    state: {
      ...state,
      version: newVersion,
      messages: [...state.messages, msg],
      nextMessageSeq: state.nextMessageSeq + 1,
      nextSegmentSeq: nextSegSeq,
    },
    patches: [patch],
  }
}

// ─── slice session-host-pending-surface C1: pending + turn-boundary helpers ───

export type PendingKind = "permission" | "elicitation"

/** מכניס בקשה ממתינה ל-state ומחזיר את ה-patch המשדר אותה. טהור. */
export function applyPendingRequest(
  state: SessionState,
  entry:
    | { kind: "permission"; value: PendingPermission }
    | { kind: "elicitation"; value: PendingElicitation },
): { state: SessionState; patches: Patch[] } {
  const newVersion = state.version + 1
  // מלכודת א' (spread לא deep-merge ב-applyPatch): pending חייב לשאת את שני השדות תמיד.
  const newPending = { ...state.pending, [entry.kind]: entry.value }
  const patch: Patch = {
    version: newVersion,
    op: "update-session",
    changes: { pending: newPending },
  }
  return {
    state: { ...state, version: newVersion, pending: newPending },
    patches: [patch],
  }
}

/** מנקה בקשה ממתינה **רק אם ה-requestId עדיין הנוכחי**; אחרת no-op מוחלט. */
export function clearPendingRequest(
  state: SessionState,
  kind: PendingKind,
  requestId: number,
): { state: SessionState; patches: Patch[] } {
  const current = state.pending[kind]
  if (!current || current.requestId !== requestId) {
    return { state, patches: [] }
  }
  const newVersion = state.version + 1
  const newPending = { ...state.pending, [kind]: null }
  const patch: Patch = {
    version: newVersion,
    op: "update-session",
    changes: { pending: newPending },
  }
  return {
    state: { ...state, version: newVersion, pending: newPending },
    patches: [patch],
  }
}

/** תחילת תור: turnState="waiting" ומנקה lastTurnError. no-op אם שניהם כבר במצב הזה. */
export function applyTurnStart(state: SessionState): { state: SessionState; patches: Patch[] } {
  if (state.turnState === "waiting" && state.lastTurnError === null) {
    return { state, patches: [] }
  }
  const newVersion = state.version + 1
  const changes = { turnState: "waiting" as const, lastTurnError: null }
  const patch: Patch = { version: newVersion, op: "update-session", changes }
  return {
    state: { ...state, version: newVersion, ...changes },
    patches: [patch],
  }
}

/**
 * סיום תור: turnState="idle" + lastTurnError (האובייקט אם נכשל, null אם הצליח/בוטל).
 * patch אחד אטומי לשני השדות. no-op אם שניהם כבר במצב הזה.
 *
 * ⚠️ error מגיע בנוי במלואו, כולל at — העוזר אינו קורא לשעון.
 * 🔴 applyTurnEnd(state) בלי שגיאה על state שכבר idle הוא no-op גמור — אינו מאפס
 * lastTurnError קיים (מונע מחיקה בשקט ע"י cancel שאחרי תור שנכשל — ר' C1 כלל 3).
 */
export function applyTurnEnd(
  state: SessionState,
  error?: { message: string; at: number },
): { state: SessionState; patches: Patch[] } {
  if (error === undefined && state.turnState === "idle") {
    return { state, patches: [] }
  }
  const newVersion = state.version + 1
  const changes = { turnState: "idle" as const, lastTurnError: error ?? null }
  const patch: Patch = { version: newVersion, op: "update-session", changes }
  return {
    state: { ...state, version: newVersion, ...changes },
    patches: [patch],
  }
}
