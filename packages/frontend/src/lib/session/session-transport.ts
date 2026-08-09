/**
 * session-transport.ts — resolveSessionTransport(): טהור (בלי window/location).
 *
 * דגל בחירת-מימוש: `local` (הנתיב הקיים, ברירת-מחדל) | `remote` (RemoteSessionView).
 * ⚠️ השם `sessionTransport` — לא `sessionMode` (תפוס: configName.sessionMode הוא
 * אפשרות config של ה-CLI, דומיין אחר לגמרי).
 *
 * קדימות **נעולה**: query ← stored ← env ← "local". ערך לא-מוכר → יורדים לרמה
 * הבאה (❌ לא זורקים). case-insensitive אחרי trim.
 *
 * `stored` (sessionStorage) נחוץ כי `?sessionTransport=` לא שורד `goto("/chat")`/refresh.
 *
 * ─── slice view-switch C2 (TDD) ───
 */

export type SessionTransport = "local" | "remote"

/** מנרמל קלט גולמי (trim + lowercase) ל-SessionTransport תקין, או null אם לא מוכר. */
function normalize(value: string | null | undefined): SessionTransport | null {
  if (value == null) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "local" || normalized === "remote") return normalized
  return null
}

/**
 * resolveSessionTransport — טהור, בלי side-effects ובלי גישה ל-window/location/
 * sessionStorage. הקורא (connect-agent.ts) אחראי לספק את שלושת המקורות.
 */
export function resolveSessionTransport(input: {
  query?: string | null
  stored?: string | null
  env?: string | undefined
}): SessionTransport {
  return normalize(input.query) ?? normalize(input.stored) ?? normalize(input.env) ?? "local"
}
