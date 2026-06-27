/**
 * formatting.ts — עזרי עיצוב טקסט.
 *
 * ui-polish-batch · C2
 *
 * הערה: formatDate (relative-time) נמצא ב-SessionPicker.svelte ומשתמש
 * ב-Intl.RelativeTimeFormat — שונה מפונקציה זו.
 */

/**
 * מחזיר שעה קצרה בפורמט HH:MM.
 * משתמש ב-Intl.DateTimeFormat לתמיכה מלאה בלוקאל ואזורי זמן.
 *
 * @param ts — timestamp במילישניות (Date.now() / Date.getTime())
 */
export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts))
}

/**
 * זמן יחסי קריא ("לפני 2 דקות" / "עכשיו") מתוך epoch-ms.
 * @param epochMs  זמן הפלט (Date.getTime()/Date.now()), epoch-ms.
 * @param locale   קוד locale (למשל "he" / "en") — מ-i18n, לא hardcode.
 * @param now      epoch-ms נוכחי; ברירת מחדל Date.now(). מוזרק לדטרמיניזם בטסט.
 */
export function formatRelativeTime(epochMs: number, locale: string, now?: number): string {
  const currentMs = now ?? Date.now()
  const diff = currentMs - epochMs

  // clamp עתיד: clock skew → התייחס כ-0
  const absDiff = diff < 0 ? 0 : diff

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })

  const seconds = Math.floor(absDiff / 1_000)
  const minutes = Math.floor(absDiff / 60_000)
  const hours = Math.floor(absDiff / 3_600_000)
  const days = Math.floor(absDiff / 86_400_000)

  if (absDiff < 1_000) {
    // פחות מ-1 שנייה (כולל clamped 0)
    return rtf.format(0, "second")
  } else if (seconds < 60) {
    return rtf.format(-seconds, "second")
  } else if (minutes < 60) {
    return rtf.format(-minutes, "minute")
  } else if (hours < 24) {
    return rtf.format(-hours, "hour")
  } else {
    return rtf.format(-days, "day")
  }
}
