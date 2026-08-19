/**
 * מודל Bubble — משותף בין view-models, קומפוננטות וה-Speaker.
 *
 * איחוד מובחן (Discriminated union) לפי `kind`. כל סוג (variant) נושא בדיוק את השדות
 * שהוא צריך; צרכנים שלא צריכים שדה מסוים פשוט לא ניגשים אליו.
 *
 * ב-slice 2 אנו משתמשים ב-`user`, `message`, `thought`. סוג ה-`tool` מוצהר עכשיו כדי
 * שסלייסים מאוחרים יותר יוכלו להשתמש בו ללא רפקטור אטומי נוסף (כלל זהב
 * #5: אין "תאימות לאחור במקום").
 *
 * ⚠️ **אל תרחיב את המודל הדרגתית** — כלומר אל תתלה שדה חדש על הטיפוס הקרוב ביותר
 * בכל פעם שמגיע צורך. זה בדיוק הדפוס שיצר ב-FE הישן את `messages` + `bubbles`
 * הכפולים ואת `segmentCache` שמעולם לא אוכלס. הכלל: מודל מחושב פעם אחת קדימה עם
 * כל השדות הצפויים, ומי שלא צריך שדה עדיין פשוט **לא מציב** אותו. שדות אופציונליים
 * על variant הם לגיטימיים כשהם נגזרים מהתכנון הזה (`recordingId`, `attachments`,
 * `subFrames`); מה שאסור הוא להוסיף אותם אד-הוק כתחליף לחשיבה על המודל.
 */

export type Segment = {
  id: string
  text: string
}

export type ThoughtSegment = Segment & {
  /** טקסט מקורי (לפני תרגום) — מאוכלס על ידי ה-Speaker לאחר התרגום לעברית. */
  originalText?: string
}

export type BubbleBase = {
  id: string
  /** מזהה הודעת ACP — null עבור בועות סינתטיות (פרומפטים של משתמש, tool calls). */
  messageId: string | null
  createdAt: number
}

export type UserBubble = BubbleBase & {
  kind: "user"
  /**
   * פרומפטים חיים (sendPrompt): תמיד null — בועה סינתטית ואופטימית.
   * ניגון היסטוריה (loadSession → user_message_chunk): מזהה הודעת ACP, משמש לקיבוץ
   * מקטעים עוקבים של אותה הודעת משתמש היסטורית לתוך בועה אחת.
   */
  messageId: string | null
  segments: Segment[]
  /** Slice 10 — מזהה בתוך ה-BE RecordingsStore עבור ניגון מחדש (replay). */
  recordingId?: string
  /**
   * slice-image-paste (Commit 3) — תמונות שנשלחו עם הפרומפט.
   * optional ו-additive: בועות קיימות (ללא תמונות) לא מושפעות.
   * Commit 4 מאכלס את השדה; Commit 3 רק מרנדר (mock).
   */
  attachments?: { mimeType: string; dataBase64: string }[]
  /**
   * slice-image-paste §11.3א — תוכן לא-טקסטואלי מ-replay (resource_link / audio / resource).
   * הרכיב (UserBubble) אחראי לתרגום הtitle/aria-label דרך t().
   * ה-VM לא מייבא t ולא כותב מחרוזות-תצוגה — שכבת-הרכיב בלבד.
   * label: raw data (name/uri) — ללא אינטרפולציה.
   */
  contentPlaceholders?: { kind: "resource_link" | "audio" | "resource"; label?: string }[]
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
// chat-render-polish: תמונה מה-agent (ACP ImageContent או EmbeddedResource עם blob image/*)
// data = base64 גולמי (ללא "data:" prefix) — הרינדור בונה את ה-data-URI
export type ToolContentImage = { type: "image"; data: string; mimeType: string }
export type ToolContentOther = { type: "other"; raw: unknown } // audio/resource/unknown
export type ToolContent = ToolContentText | ToolContentDiff | ToolContentTerminal | ToolContentImage | ToolContentOther

export type ToolLocation = { path: string; line?: number }

// ─── slice subagent-transcript-data-v2: תעתיק תת-סוכן (additive) ───
// שכבת-נתונים בלבד — אין רינדור.

/** מצב תת-הסוכן, נגזר ממקורות _claude/sdkMessage (task_started/progress/notification/updated). */
export type SubagentTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "unknown"

/** metadata של Task/תת-סוכן, ממופה על ToolCall.task. הליבה = prompt + summary (value_priority, decisions 2026-07-11). */
export type TaskMeta = {
  taskId?: string
  subagentType?: string
  prompt?: string
  summary?: string
  lastToolName?: string
  status: SubagentTaskStatus
}

/**
 * SubFrame — פריט בתעתיק המקונן (subFrames) של בועת Task.
 * subset של Bubble — message/thought/tool בלבד (אין UserBubble) — reuse ל-renderer ב-B2.
 */
export type SubFrame = MessageBubble | ThoughtBubble | ToolBubble

export type ToolCall = {
  toolCallId: string
  name: string
  args: unknown
  status: "pending" | "in_progress" | "completed" | "failed"
  /** כותרת ACP גולמית (טכנית). */
  title?: string
  /** פרוזה שנוצרה על ידי Gemini (בעברית). */
  narration?: string
  /** סוג הכלי (ToolKind) של ACP: read/edit/delete/move/search/execute/think/fetch/switch_mode/other */
  kind?: string
  /** פלט גולמי שהוחזר על ידי הכלי (מתוך ACP rawOutput). */
  result?: unknown
  // ─── slice 16 (ACP content) ───
  content?: ToolContent[]
  locations?: ToolLocation[]
  /** slice subagent-transcript-data-v2 — metadata של Task/תת-סוכן. undefined = לא-Task tool call. */
  task?: TaskMeta
}

export type ToolBubble = BubbleBase & {
  kind: "tool"
  messageId: null
  toolCall: ToolCall
  /** תמיד ריק — שומר על מבנה אחיד מול בועות תוכן עבור האיחוד (union). */
  segments: never[]
  /** slice subagent-transcript-data-v2 — תעתיק תת-סוכן מקונן. undefined = לא-Task tool call. */
  subFrames?: SubFrame[]
}

export type Bubble = UserBubble | MessageBubble | ThoughtBubble | ToolBubble
