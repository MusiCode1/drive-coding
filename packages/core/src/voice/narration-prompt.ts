/**
 * narration-prompt.ts — פונקציה טהורה לבניית פרומפטים של קריינות.
 *
 * הוסב (Ported) מ-packages/backend/src/voice/narration.ts:buildNarratePrompt.
 * זה יושב ב-core כי זו לוגיקה טהורה ללא תלויות IO.
 */

// ─── סוגי Tool / Context ─────────────────────────────────────

export interface NarrateContext {
  /** מה המשתמש אמר (אחרי STT). */
  userMessage: string
  /** FIFO של עד 3 הודעות עוזר אחרונות (עבור הקשר). */
  recentMessages: string[]
}

export interface ToolCallForNarrate {
  /** מזהה קריאת tool ייחודי — משמש כמפתח מטמון. */
  toolCallId: string
  /** סוג ACP ToolKind: read/edit/execute/search/think/... */
  kind?: string
  /** כותרת גולמית כפי שסופקה על ידי המודל. */
  title: string
}

// ─── דוגמאות (מיוצאות עבור בדיקות) ───────────────────────────

export const NARRATE_EXAMPLES = `Examples:
- Tool: read README.md          → "אני בודק את ה-README כדי לראות מה הפרויקט"
- Tool: execute bash "ls"       → "אני מציץ מה יש בתיקייה"
- Tool: edit hello.js           → "מעדכן את הפונקציה שדיברנו עליה"
- Tool: execute "npm run build" → "מריץ build לראות שאין שגיאות"`

// ─── buildNarratePrompt — טהורה ────────────────────────────────

/**
 * בונה את פרומפט הקריינות. פונקציה טהורה — מיוצאת עבור בדיקות.
 * הוסבה מ-packages/backend/src/voice/narration.ts:buildNarratePrompt.
 */
export function buildNarratePrompt(ctx: NarrateContext, tool: ToolCallForNarrate): string {
  const recent = ctx.recentMessages.length ? ctx.recentMessages.join(" · ") : "—"
  return `You are narrating a coding assistant's actions out loud in Hebrew.
Given the user's request and recent context, describe in ONE short
conversational Hebrew sentence what the assistant is about to do —
and WHY in this context. Don't list parameters; explain the intent.
Don't repeat the user's words verbatim.

${NARRATE_EXAMPLES}

User said: "${ctx.userMessage}"
Recent assistant context: ${recent}

Tool: ${tool.kind ?? "?"} — ${tool.title}

Output ONLY the Hebrew sentence (no quotes, no markdown).`
}
