/**
 * מודל Bubble — משותף בין view-models, קומפוננטות וה-Speaker.
 *
 * איחוד מובחן (Discriminated union) לפי `kind`. כל סוג (variant) נושא בדיוק את השדות
 * שהוא צריך; צרכנים שלא צריכים שדה מסוים פשוט לא ניגשים אליו. ראה
 * את `packages/frontend/docs/bubble-model.md` להסבר המלא.
 *
 * ב-slice 2 אנו משתמשים ב-`user`, `message`, `thought`. סוג ה-`tool` מוצהר עכשיו כדי
 * שסלייסים מאוחרים יותר יוכלו להשתמש בו ללא רפקטור אטומי נוסף (כלל זהב
 * #5: אין "תאימות לאחור במקום").
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
}

export type ToolBubble = BubbleBase & {
  kind: "tool"
  messageId: null
  toolCall: ToolCall
  /** תמיד ריק — שומר על מבנה אחיד מול בועות תוכן עבור האיחוד (union). */
  segments: never[]
}

export type Bubble = UserBubble | MessageBubble | ThoughtBubble | ToolBubble
