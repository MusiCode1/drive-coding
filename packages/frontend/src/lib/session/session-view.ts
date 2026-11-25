/**
 * session-view.ts — SessionView port.
 *
 * The view model consumes this contract. RemoteSessionView connects to the server's
 * SessionHost through either WebSocket or HTTP with SSE.
 *
 * ─── slice session-view-port C2 ───
 */

import type { Patch, SessionMessage, SessionState } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import type { SessionInfo } from "$lib/adapters/sessions"

export type ViewTerminal = { terminal: true; terminalError?: string }

export type HistoryWindowState = {
  firstSeq: number | null
  lastSeq: number | null
  hasMore: boolean
  watermark: number
}

/** Single delivery unit from view to VM. Order guaranteed: same channel, same queue. */
export type ViewEmission = {
  /** Patches produced from the batch. Advance view state. */
  patches: Patch[]
  /** Raw session/update as received from the wire. Empty on synthetic reset. */
  updates: unknown[]
  /** The reader has stopped reconnecting and this session is no longer attached. */
  terminal?: true
  /** Crash reason fetched by the view after the session stream ends. */
  terminalError?: string
  activity?: true
  historyState?: {
    window: HistoryWindowState
    error: string | null
    reloading: boolean
    loadingOlder: boolean
    olderError: string | null
  }
} & (
  | { history: "older"; messages: SessionMessage[] }
  | { history?: "tail" | "reload" | "reset"; messages?: never }
)

export type HistoryController = {
  readonly window: HistoryWindowState
  readonly error: string | null
  readonly reloading: boolean
  readonly loadingOlder: boolean
  readonly olderError: string | null
  loadOlder(): Promise<void>
  retry(): Promise<void>
}

export function readViewEmission(
  session: { status: string; error: string | null },
  emission: ViewEmission | undefined,
): ViewEmission | undefined {
  if (emission?.terminalError) session.error = emission.terminalError
  if (emission?.terminal && session.status === "connected") session.status = "disconnected"
  if (
    emission &&
    (emission.patches.length > 0 ||
      emission.updates.length > 0 ||
      emission.history !== undefined ||
      emission.historyState !== undefined ||
      emission.activity === true)
  ) {
    return emission
  }
}

/**
 * SessionView — port עבור גישה למצב הסשן + methods לניהולו.

 */
export interface SessionView {
  /** מצב הסשן העכשווי — כולל כל שדות SessionState מ-C1 (status, turnState, pending, ...). */
  readonly state: SessionState

  /**
   * ReadableStream<ViewEmission> — patch + raw update delivery channel.
   * Each frame is one ViewEmission from a single reduce batch (agent_message_chunk,
   * tool_call, etc.). The VM reads this for targeted bubble reactivity.
   *
   * ⚠️ stream חי — הצרכן חייב לקרוא (getReader()) כדי למנוע backpressure.
   * ⚠️ ReadableStream ניתן לצריכה פעם אחת בלבד (לא tee אלא אם צריך).
   */
  readonly patches: ReadableStream<ViewEmission>

  /**
   * שולח פרומפט (טקסט או PromptBlocks).
   * מגדיר turnState='waiting' לפני שליחה, 'idle' אחרי RESP.
   * meta: תיק אטום שיצורף ל-SessionMessage (S3 — meta passthrough).
   */
  prompt(content: string | PromptBlocks, meta?: Record<string, unknown>): Promise<void>

  /** מבטל תור פעיל. מגדיר turnState='idle'. */
  cancel(): Promise<void>

  /**
   * מגיב לבקשת הרשאה/elicitation ממתינה.
   * `requestId` מגיע מ-state.pending.permission.requestId / state.pending.elicitation.requestId.
   * `result` הוא PermissionResponse / ElicitationResponse (opaque לפורט).
   */
  respond(requestId: number, result: unknown): Promise<void>

  /** מגדיר mode פעיל. */
  setMode(mode: string): Promise<void>

  /** מגדיר config option. */
  setConfigOption(key: string, value: unknown): Promise<void>

  /** שולח ext request (_drive/* וכו'). */
  extMethod(method: string, params: unknown): Promise<unknown>

  /**
   * יוצר session ACP חדש.
   * local: cwd נקבע בבנייה (ארגומנט אופציונלי להתעלמות).
   * remote: cwd אופציונלי — כמו loadSession; fallback ל-cwd של החיבור ב-BE.
   */
  newSession(cwd?: string): Promise<void>

  /**
   * טוען session ACP קיים לפי sessionId.
   * cwd/cliKind נקבעו בבנייה; cwd אופציונלי — כשנמסר, מחליף את cwd החיבור
   * (slice remote-session-mgmt C5: ה-cwd של הסשן הנבחר עובר עד ה-CLI, parity עם local).
   */
  loadSession(sessionId: string, cwd?: string): Promise<void>

  /** מחזיר רשימת sessions הזמינים. */
  listSessions(): Promise<SessionInfo[]>

  /** מוחק session. */
  deleteSession(sessionId: string): Promise<void>

  /**
   * האם הסשן הנוכחי תומך במחיקה (sessionCapabilities.delete).
   * local: raw client capabilities; remote: מתשובת listSessions (false עד התשובה
   * הראשונה). slice remote-session-mgmt C5 — ה-port חושף, ה-VM צורך.
   */
  readonly supportsSessionDelete: boolean

  /** מחליף מודל לסשן הפעיל. */
  setSessionModel(model: string): Promise<void>

  /** סוגר את החיבור ומפנה משאבים. מבטל pending permission/elicitation כ-cancelled. */
  close(): Promise<void>

  /** Tail/history window control (slice fast-session-open-1). */
  readonly history: HistoryController
}
