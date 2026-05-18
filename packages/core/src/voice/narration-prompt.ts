/**
 * narration-prompt.ts — pure function for building narration prompts.
 *
 * Ported from packages/backend/src/voice/narration.ts:buildNarratePrompt.
 * This lives in core because it's pure logic with no IO dependencies.
 */

// ─── Context / Tool types ─────────────────────────────────────

export interface NarrateContext {
  /** What the user said (post-STT). */
  userMessage: string
  /** FIFO max 3 of recent assistant messages (for context). */
  recentMessages: string[]
}

export interface ToolCallForNarrate {
  /** Unique tool call ID — used as cache key. */
  toolCallId: string
  /** ACP ToolKind: read/edit/execute/search/think/... */
  kind?: string
  /** Raw title as supplied by the model. */
  title: string
}

// ─── Examples (exported for tests) ───────────────────────────

export const NARRATE_EXAMPLES = `Examples:
- Tool: read README.md          → "אני בודק את ה-README כדי לראות מה הפרויקט"
- Tool: execute bash "ls"       → "אני מציץ מה יש בתיקייה"
- Tool: edit hello.js           → "מעדכן את הפונקציה שדיברנו עליה"
- Tool: execute "npm run build" → "מריץ build לראות שאין שגיאות"`

// ─── buildNarratePrompt — pure ────────────────────────────────

/**
 * Builds the narration prompt. Pure function — exported for tests.
 * Ported from packages/backend/src/voice/narration.ts:buildNarratePrompt.
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
