/**
 * session-transport.ts — resolveSessionTransport(): טהור (בלי window/location).
 *
 * דגל בחירת-מימוש: `ws` (WebSocket — הנתיב הקיים, ברירת-מחדל) | `http`
 * (RemoteSessionView → BE SessionHost דרך HTTP+SSE).
 * ⚠️ השם `sessionTransport` — לא `sessionMode` (תפוס: configName.sessionMode הוא
 * אפשרות config של ה-CLI, דומיין אחר לחלוטין).
 *
 * מינוח מיושן (נרדפים): `local`→`ws` · `remote`→`http`. נשמר לתאימות-אחור
 * עם ערכים קיימים ב-sessionStorage וב-env (FE_SESSION_TRANSPORT).
 *
 * קדימות **נעולה**: query ← override ← stored ← env ← "ws". ערך לא-מוכר →
 * יורדים לרמה הבאה (❌ לא זורקים). case-insensitive אחרי trim.
 *
 * שתי שכבות אחסון (slice transport-polish §3):
 *  - **עקיפה** — `override` מ-sessionStorage (מפתח `sessionTransport`): חיה בטאב,
 *    נכתבת ע"י `?sessionTransport=` ב-URL דרך connect-agent / +layout.
 *  - **העדפה** — `stored` מ-localStorage (שדה ב-settings): קבועה, נכתבת דרך ה-Select
 *    בהגדרות. `null` = "לא נבחרה העדפה" → הקדימות ממשיכה ל-env.
 *
 * ─── slice view-switch C2 (TDD) · slice transport-polish C1 ───
 */

export type SessionTransport = "ws" | "http"

/** מנרמל קלט גולמי (trim + lowercase + מיפוי נרדפים) ל-SessionTransport תקין, או null אם לא מוכר. */
export function normalizeSessionTransport(
  value: string | null | undefined,
): SessionTransport | null {
  if (value == null) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "ws" || normalized === "http") return normalized
  // נרדפים מיושנים (local/remote) — תאימות אחור
  if (normalized === "local") return "ws"
  if (normalized === "remote") return "http"
  return null
}

/**
 * resolveSessionTransport — טהור, בלי side-effects ובלי גישה ל-window/location/
 * sessionStorage. הקורא (connect-agent.ts) אחראי לספק את ארבעת המקורות.
 */
export function resolveSessionTransport(input: {
  query?: string | null
  /** עקיפה מ-sessionStorage — חיה בטאב (§3). */
  override?: string | null
  /** העדפה מ-localStorage — קבועה (§3). null = לא נבחרה העדפה. */
  stored?: string | null
  env?: string | undefined
}): SessionTransport {
  return (
    normalizeSessionTransport(input.query) ??
    normalizeSessionTransport(input.override) ??
    normalizeSessionTransport(input.stored) ??
    normalizeSessionTransport(input.env) ??
    "ws"
  )
}
