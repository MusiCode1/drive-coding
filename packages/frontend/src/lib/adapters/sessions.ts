/**
 * sessions.ts — types ופונקציית נרמול עבור session data מה-ACP.
 *
 * slice connect-recent-projects: הוסרה listSessionsForCwd (spawn חד-פעמי יקר).
 * בחירת סשן מ-דף-החיבור הוסרה — עוברת לתוך הסשן הפעיל (SessionOptionsPanel).
 *
 * SessionInfo + normalizeSessionInfo נשמרים — בשימוש חי ב:
 *   - agent-session.svelte.ts:37 (listSessions inline דרך ACP קיים)
 *   - SessionCard.svelte:7
 */

export type SessionInfo = {
  sessionId: string
  cwd: string
  title: string // מחרוזת ריקה אם ה-CLI לא מחזיר כותרת
  updatedAt: string // חותמת זמן ISO (או מחרוזת ריקה אם חסר)
}

/** ממיר נתוני session גולמיים מה-ACP לצורת SessionInfo. ─── slice sessions-inline: ייצוא ל-AgentSession ─── */
export function normalizeSessionInfo(s: unknown): SessionInfo {
  const item = s as Record<string, unknown>
  return {
    sessionId: String(item["sessionId"] ?? ""),
    cwd: String(item["cwd"] ?? ""),
    title: String(item["title"] ?? ""),
    updatedAt: String(item["updatedAt"] ?? ""),
  }
}
