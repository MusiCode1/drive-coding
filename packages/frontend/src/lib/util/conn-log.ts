/**
 * conn-log.ts — יומן מצב-חיבור לקונסול (slice liveness, סבב-תיקונים).
 *
 * למה: מרגע שהבאנר הוא בעל-הבית של מצב-החיבור, המחרוזות הגולמיות
 * (`WS closed (1006)`, `Failed to fetch`) **אינן מוצגות למשתמש** — והן עדיין
 * המידע היחיד שמאפשר לאבחן ניתוק. הן עוברות לכאן.
 *
 * נפח נמוך בכוונה: רק אירועי-מעבר (נפילה · ניסיון · חזרה), לא כל tick.
 */

/** תג אחיד — `[conn]` נותן `grep`/סינון-קונסול אחד לכל מצב-החיבור. */
const TAG = "[conn]"

function fmt(detail?: Record<string, unknown>): string {
  if (!detail) return ""
  return Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ")
}

/** מעבר תקין — חיבור, חזרה, סגירה מכוונת. */
export function connInfo(event: string, detail?: Record<string, unknown>): void {
  console.info(`${TAG} ${event}`, fmt(detail))
}

/** נפילה או כשל — מה שהמשתמש **לא** רואה יותר על המסך. */
export function connWarn(event: string, detail?: Record<string, unknown>): void {
  console.warn(`${TAG} ${event}`, fmt(detail))
}
