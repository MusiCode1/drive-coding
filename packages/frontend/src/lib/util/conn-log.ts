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

/**
 * חוצץ-מעגלי של אירועי-חיבור.
 *
 * למה: באבחון #41 שרדו בקונסול **שלוש שורות** — ניווט מנקה אותו, ואיתו כל
 * ההיסטוריה שהייתה מכריעה. החוצץ שורד ניווט ב-SPA ונקרא דרך `__dc.conn()`.
 */
export type ConnEvent = { t: number; level: "info" | "warn"; event: string; detail: string }
const RING_MAX = 200
const ring: ConnEvent[] = []

function push(level: "info" | "warn", event: string, detail: string): void {
  ring.push({ t: Date.now(), level, event, detail })
  if (ring.length > RING_MAX) ring.shift()
}

/** האירועים האחרונים, החדש בסוף. תמונת-מצב — לא הרפרנס. */
export function connEvents(): ConnEvent[] {
  return [...ring]
}

function fmt(detail?: Record<string, unknown>): string {
  if (!detail) return ""
  return Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ")
}

/** מעבר תקין — חיבור, חזרה, סגירה מכוונת. */
export function connInfo(event: string, detail?: Record<string, unknown>): void {
  const d = fmt(detail)
  push("info", event, d)
  console.info(`${TAG} ${event}`, d)
}

/** נפילה או כשל — מה שהמשתמש **לא** רואה יותר על המסך. */
export function connWarn(event: string, detail?: Record<string, unknown>): void {
  const d = fmt(detail)
  push("warn", event, d)
  console.warn(`${TAG} ${event}`, d)
}
