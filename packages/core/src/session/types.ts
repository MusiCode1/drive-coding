/**
 * session/types.ts — SessionState / SessionMessage / Patch — pure types.
 *
 * מודל-המצב של שיחה: גרסה core בלבד, ללא IO, ללא browser globals.
 * ids דטרמיניסטיים: m_<seq> / s_<seq> — לעולם לא crypto.randomUUID (browser global + לא-דטרמיניסטי).
 *
 * ─── slice session-state-reducer C0 (TDD) ───
 */

// ─── Roles ───

export type SessionRole = "user" | "thought" | "assistant" | "tool"

// ─── Segments ───

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
 */
export type SessionMessage =
  | {
      id: string
      role: "user" | "thought" | "assistant"
      messageId: string | null
      segments: SessionSegment[]
    }
  | {
      id: string
      role: "tool"
      messageId: null
      toolCall: SessionToolCall
    }

// ─── State ───

export type SessionState = {
  /** מונה-על; כל reduce / applyPatch מעלה ב-1 */
  version: number
  sessionId: string | null
  messages: SessionMessage[]
  /** מונה דטרמיניסטי ל-ids של messages (m_<n>) */
  nextMessageSeq: number
  /** מונה דטרמיניסטי ל-ids של segments (s_<n>) */
  nextSegmentSeq: number
}

// ─── Patches ───

/**
 * Patch — פורמט ממוקד-מטרה, תומך בהחלה מוטבילית (§8.3, FE reactivity).
 *
 * ⚠️ targetId נושא את ה-id הסינתטי (m_<seq>), לא את messageId של ACP.
 * אביגיל #3: ToolBubble.messageId תמיד null — התאמה על targetId בלבד מונחת.
 */
export type Patch =
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

// ─── Helpers ───

/** יוצר SessionState ריק עם sessionId נתון. */
export function createInitialSessionState({ sessionId }: { sessionId: string | null }): SessionState {
  return {
    version: 0,
    sessionId,
    messages: [],
    nextMessageSeq: 0,
    nextSegmentSeq: 0,
  }
}

/** קבוע נוחות — state ריק. */
export const INITIAL_SESSION_STATE: SessionState = createInitialSessionState({ sessionId: null })
