/**
 * conversation.ts — ה-`CONVERSATION` המשותף לשערי ה-round-trip.
 *
 * 🔴 **מקור אחד, ובכוונה.** שני שערים נשענים עליו — ה-round-trip של
 * ‏`to-session-update.test.ts` ו"ה-`CONVERSATION` הקיים ⇒ `carried` ריק" של
 * ‏`carried.test.ts`. שכפולו היה מאפשר למחגר לעבוד בקובץ אחד ולהירקב בשני.
 *
 * ⚠️ **אל תוסיף כאן הודעה עם `messageId: null`.** היא נכשלת ב-round-trip
 * **כבר על הבסיס** ולא באשמת שינוי כלשהו: ‏`midMeta` פולט
 * `{"_drive/messageId": null}`, וההודעה המשוחזרת נושאת `meta` שלא היה במקור.
 *
 * ─── slice carried-snapshot ───
 */

/** חותמת-הזמן שה-SDK מטביע על הודעת ה-assistant `A1`. */
export const A1_TS = "2026-09-22T08:30:00.000Z"

export const CONVERSATION = [
  { sessionUpdate: "session_info_update", title: "A real session" },
  {
    sessionUpdate: "user_message_chunk",
    messageId: "U1",
    content: { type: "text", text: "hello" },
  },
  {
    sessionUpdate: "agent_thought_chunk",
    messageId: "T1",
    content: { type: "text", text: "thinking…" },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "A1",
    content: { type: "text", text: "part one " },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "A1",
    content: { type: "text", text: "part two" },
  },
  // 🔴 ה-`mid` כאן **חייב** להיות messageId שקיים בשיחה (`"A1"`). מזהה יתום
  // היה נרשם ב-`messageTimestamps` בלי הודעה נושאת — וזה בדיוק המקרה ש-§6
  // מחריג מה-scope, כלומר השער לא היה יכול לעבור מסיבה שאינה באג.
  {
    sessionUpdate: "_drive/ext_notification",
    method: "_claude/sdkMessage",
    params: {
      message: {
        type: "assistant",
        timestamp: A1_TS,
        message: { id: "A1" },
      },
    },
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tc-1",
    kind: "read",
    title: "Read",
    rawInput: { path: "/x" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tc-1",
    status: "completed",
    rawOutput: "contents",
  },
  {
    sessionUpdate: "available_commands_update",
    availableCommands: [{ name: "c", description: "d" }],
  },
  { sessionUpdate: "config_option_update", configOptions: [{ id: "mode", category: "mode" }] },
  { sessionUpdate: "current_mode_update", currentModeId: "auto" },
  { sessionUpdate: "usage_update", used: 10, size: 100, cost: 0.5 },
]
