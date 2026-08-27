/**
 * live-agent-prompt.ts — ACP agent-facing instructions (Hebrew allowed here only).
 *
 * Slice: agent-secretary-prompt, Commit 0.
 * Separate from live-prompt.ts (secretary system prompt) — opposite roles.
 */

/** Prefix on secretary→agent prompts — not a direct user utterance. */
export const LIVE_SECRETARY_TO_AGENT_MARKER = "[מזכיר]"

/** Wraps secretary-dispatched text so the agent knows it is not a direct user utterance. */
export function formatSecretaryToAgent(text: string): string {
  return `${LIVE_SECRETARY_TO_AGENT_MARKER} ${text}`
}

/** One-shot instruction sent to the ACP agent when Live opens. */
export function buildLiveAgentPrompt(): string {
  return [
    `ההודעות המתווגות ${LIVE_SECRETARY_TO_AGENT_MARKER} הגיעו ממזכיר קולי, לא מהמשתמש ישירות.`,
    "המשתמש נוהג ומקשיב — הוא אינו רואה מסך. ענה קצר. בלי טבלאות.",
    "מזהי-קוד (שמות קבצים, נתיבים, פקודות) — אמור בבירור ובנפרד, כי הם",
    "עוברים תמלול והם השלב שבו מידע אובד.",
  ].join("\n")
}
