import { type } from "arktype"

// ─── לקוח → שרת ─────────────────────────────────────────

export const PingMessage = type({ type: "'ping'" })
export type PingMessage = typeof PingMessage.infer

// Slice 4: prompt + cancel
export const PromptMessage = type({
  type: "'prompt'",
  text: "string >= 1",
})
export type PromptMessage = typeof PromptMessage.infer

export const CancelMessage = type({ type: "'cancel'" })
export type CancelMessage = typeof CancelMessage.infer

// Slice 5: הודעת קול אודיו
export const AudioMessage = type({
  type: "'audio'",
  agentId: "string",
  audioBase64: "string",
  mimeType: "string",
})
export type AudioMessage = typeof AudioMessage.infer

export const ClientMessage = PingMessage.or(PromptMessage).or(CancelMessage).or(AudioMessage)
export type ClientMessage = typeof ClientMessage.infer

// ─── שרת → לקוח ─────────────────────────────────────────

export const HelloMessage = type({ type: "'hello'", version: "string" })
export type HelloMessage = typeof HelloMessage.infer

export const PongMessage = type({
  type: "'pong'",
  echoOf: "string",
  serverTime: "number",
})
export type PongMessage = typeof PongMessage.infer

// Slice 4: הודעות שרת עשירות
export const ConnectedMessage = type({
  type: "'connected'",
  agentId: "string",
})
export type ConnectedMessage = typeof ConnectedMessage.infer

export const ThinkingMessage = type({
  type: "'thinking'",
})
export type ThinkingMessage = typeof ThinkingMessage.infer

/**
 * מקטע טקסט מה-ACP — מוזרם בהדרגה.
 *
 * תוספות מדור 1 (שלב 4):
 *   messageId — UUID יציב על פני כל המקטעים של אותו תור message/thought.
 *     מאפשר ל-frontend לקבץ בועות ולקשר audio_chunks חזרה למקור שלהם.
 */
export const TextChunkMessage = type({
  type: "'text_chunk'",
  kind: "'message' | 'thought'",
  text: "string",
  "messageId?": "string",
})
export type TextChunkMessage = typeof TextChunkMessage.infer

/**
 * התראת קריאת tool. נשלחת באירוע `tool_call` הראשוני וגם בכל
 * `tool_call_update` — ה-frontend משתמש ב-`toolCallId` כדי למזג לאלמנט
 * UI יחיד (תג סטטוס, אזור תוכן).
 *
 * `kind`: סוג ה-ACP ToolKind = "read" | "edit" | "delete" | "move" | "search" |
 *   "execute" | "think" | "fetch" | "switch_mode" | "other"
 * `status`: סטטוס ה-ACP ToolCallStatus = "pending" | "in_progress" | "completed" | "failed"
 * `locations`: מערך של נתיבי קבצים (עבור מעקב UI "follow-along")
 * `content`: תצוגה מקדימה קריאה למשתמש של פלט ה-tool (טקסט בלבד — diff/terminal
 *   מסוכמים לשורה בודדת ב-Slice 5.5; רינדור עשיר יותר ב-Slice 7)
 *
 * תוספות מדור 1 (שלב 4):
 *   narration — משפט בעברית המתאר את פעולת ה-tool (יאכלס בהמשך דרך
 *     tool_call_update לאחר ש-narrateToolCall מסתיים).
 */
export const ToolCallMessage = type({
  type: "'tool_call'",
  toolCallId: "string",
  title: "string",
  "kind?": "string",
  "status?": "string",
  "locations?": "string[]",
  "content?": "string",
  "narration?": "string",
})
export type ToolCallMessage = typeof ToolCallMessage.infer

export const DoneMessage = type({
  type: "'done'",
  stopReason: "string",
})
export type DoneMessage = typeof DoneMessage.infer

export const ErrorMessage = type({
  type: "'error'",
  code: "string",
  message: "string",
})
export type ErrorMessage = typeof ErrorMessage.infer

// Slice 5: הודעות קול מהשרת
export const SttPartialMessage = type({
  type: "'stt_partial'",
  text: "string",
})
export type SttPartialMessage = typeof SttPartialMessage.infer

/**
 * מקטע אודיו מה-TTS.
 *
 * תוספות מדור 1 (שלב 4):
 *   segmentId — UUID ייחודי לכל מקטע TTS (משפט אחד = מקטע אחד).
 *   messageId — מזהה ההודעה/מחשבה האב (מקשר את המקטע חזרה ל-text_chunk).
 *   kind — סוג: "message" | "thought" | "narration".
 *   originalText — טקסט המקור באנגלית לפני תרגום.
 *   translatedText — טקסט בעברית שסונתז.
 */
export const AudioChunkMessage = type({
  type: "'audio_chunk'",
  mp3Base64: "string",
  "segmentId?": "string",
  "messageId?": "string",
  "kind?": "'message' | 'thought' | 'narration'",
  "originalText?": "string",
  "translatedText?": "string",
})
export type AudioChunkMessage = typeof AudioChunkMessage.infer

export const TranslationMessage = type({
  type: "'translation'",
  original: "string",
  translated: "string",
})
export type TranslationMessage = typeof TranslationMessage.infer

/**
 * נשלחת לאחר סיום narrateToolCall — מעדכנת את כרטיס ה-tool
 * בתיאור טבעי בעברית של מה שהסוכן עושה כעת.
 * דור 1 (שלב 4): אירוע חדש.
 */
export const ToolCallUpdateMessage = type({
  type: "'tool_call_update'",
  toolCallId: "string",
  narration: "string",
})
export type ToolCallUpdateMessage = typeof ToolCallUpdateMessage.infer

// ─── Slice 8a: אירועי היסטוריית Session ─────────────────────────────────────────

/**
 * נשלחת פעם אחת כאשר נטען session מההיסטוריה (לפני הזרמת history_chunk).
 * ה-frontend משתמש בזה כדי לאפס את אזור הצ'אט.
 */
export const HistoryStartMessage = type({
  type: "'history_start'",
  agentId: "string",
  sessionId: "string",
})
export type HistoryStartMessage = typeof HistoryStartMessage.infer

/**
 * מוזרם במהלך session/load — מייצג קטע של הודעה היסטורית אחת.
 * kind: 'message' | 'thought' | 'user_message'
 * messageId: UUID יציב לקיבוץ קטעים של אותו תור.
 */
export const HistoryChunkMessage = type({
  type: "'history_chunk'",
  kind: "'message' | 'thought' | 'user_message'",
  text: "string",
  messageId: "string",
})
export type HistoryChunkMessage = typeof HistoryChunkMessage.infer

/**
 * התראת קריאת tool היסטורית — דומה ל-ToolCallMessage אך
 * מוגבלת לזרם השחזור של ההיסטוריה.
 */
export const HistoryToolCallMessage = type({
  type: "'history_tool_call'",
  toolCallId: "string",
  title: "string",
  "kind?": "string",
  "status?": "string",
})
export type HistoryToolCallMessage = typeof HistoryToolCallMessage.infer

/**
 * מאותתת על סיום שחזור ההיסטוריה. ה-frontend מאפשר את הקלט לאחר מכן.
 */
export const HistoryDoneMessage = type({
  type: "'history_done'",
})
export type HistoryDoneMessage = typeof HistoryDoneMessage.infer

/**
 * נפלטת מיד לאחר שקובץ האודיו (blob) של המשתמש נשמר בדיסק
 * (לפני STT). מאפשרת ל-frontend להציג כפתור השמעה חוזרת בבועת האודיו.
 */
export const AudioRecordingSavedMessage = type({
  type: "'audio_recording_saved'",
  recordingId: "string",
  mimeType: "string",
  "durationMs?": "number",
})
export type AudioRecordingSavedMessage = typeof AudioRecordingSavedMessage.infer

export const ServerMessage = HelloMessage.or(PongMessage)
  .or(ConnectedMessage)
  .or(ThinkingMessage)
  .or(TextChunkMessage)
  .or(ToolCallMessage)
  .or(ToolCallUpdateMessage)
  .or(DoneMessage)
  .or(ErrorMessage)
  .or(SttPartialMessage)
  .or(AudioChunkMessage)
  .or(TranslationMessage)
  .or(HistoryStartMessage)
  .or(HistoryChunkMessage)
  .or(HistoryToolCallMessage)
  .or(HistoryDoneMessage)
  .or(AudioRecordingSavedMessage)

export type ServerMessage = typeof ServerMessage.infer
