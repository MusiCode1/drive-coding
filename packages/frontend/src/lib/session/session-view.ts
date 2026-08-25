/**
 * session-view.ts — SessionView port.
 *
 * ה-port מגדיר את ה-contract שה-VM צורך (C3) ו-LocalSessionView מממש (C2).
 * RemoteSessionView (S5) מממש אותו באמצעות HTTP+SSE ל-SessionHost בשרת (לא WS —
 * EventSource לא תומך ב-POST/headers, ולכן fetch+ReadableStream + reconnect ידני).
 *
 * ─── slice session-view-port C2 ───
 */

import type { Patch, SessionState } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import type { SessionInfo } from "$lib/adapters/sessions"

/** Single delivery unit from view to VM. Order guaranteed: same channel, same queue. */
export type ViewEmission = {
  /** Patches produced from the batch. Advance view state. */
  patches: Patch[]
  /** Raw session/update as received from the wire. Empty on synthetic reset. */
  updates: unknown[]
}

/**
 * SessionView — port עבור גישה למצב הסשן + methods לניהולו.
 *
 * שני מימושים:
 * - LocalSessionView (C2): עוטף AcpClient + WsAcpTransport — in-process.
 * - RemoteSessionView (S5): HTTP+SSE ל-SessionHost בשרת — out-of-process.
 *
 * ה-VM (C3) מקבל SessionView ב-DI ואינו יודע על המימוש.
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
   * cwd/cliKind נקבעו בבנייה של LocalSessionView.
   */
  newSession(): Promise<void>

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
}
