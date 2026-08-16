/**
 * formatting.ts — עזרי עיצוב טקסט.
 *
 * ui-polish-batch · C2
 * slice session-budget-meter · Commit 2: formatQuotaPeriod + formatTimeUntil
 *
 * הערה: formatDate (relative-time) נמצא ב-SessionPicker.svelte ומשתמש
 * ב-Intl.RelativeTimeFormat — שונה מפונקציה זו.
 */

import type { QuotaPeriod } from "@drive-coding/provider/extensions"

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

/**
 * ─── slice session-budget-meter · Commit 2 ───────────────────────────────
 *
 * formatQuotaPeriod / formatTimeUntil — פורמטרים גנריים ל-quota windows.
 *
 * הפרדה מכוונת מ-formatRelativeTime (עבר בלבד — brief §0 "התאמת scope"):
 * formatRelativeTime clamp-ת diff שלילי (timestamp עתידי) ל-0 ("עכשיו") —
 * זו התנהגות אנטי-flicker נכונה לצרכני-העבר הקיימים שלה (הודעות/session picker),
 * אך שגויה ל-"בעוד N דקות" של איפוס-מכסה עתידי. הרחבתה הייתה משנה behavior
 * קיים (שינוי invasive בקובץ משותף) ומפרה את ה-DoD "clock skew → now" של
 * צרכניה הקיימים. formatTimeUntil הוא לכן פונקציה נפרדת עם סמנטיקת-סימן הפוכה
 * (future-relative, לא past-relative) — לא near-duplicate מקרי.
 */

/** תקופת quota rolling→hour/day/minute/second — מ-durationSeconds בלבד, לא מ-provider ID. */
function rollingUnit(durationSeconds: number): {
  unit: "day" | "hour" | "minute" | "second"
  value: number
} {
  if (durationSeconds >= 86_400 && durationSeconds % 86_400 === 0) {
    return { unit: "day", value: durationSeconds / 86_400 }
  }
  if (durationSeconds >= 3_600 && durationSeconds % 3_600 === 0) {
    return { unit: "hour", value: durationSeconds / 3_600 }
  }
  if (durationSeconds >= 60 && durationSeconds % 60 === 0) {
    return { unit: "minute", value: durationSeconds / 60 }
  }
  return { unit: "second", value: durationSeconds }
}

/**
 * מציג תקופת quota (rolling/calendar) בפורמט קריא, לפי locale.
 * rolling: היחידה נגזרת מ-durationSeconds (5*3600s → "5 hours"), לא משם ספק.
 * calendar: מוצג כתקופה גנרית (day/week/month) — "unit" מגיע ישירות מה-snapshot.
 * מקבל אך ורק ערכים מנורמלים (QuotaPeriod); אין כאן פרשנות של provider ID.
 */
export function formatQuotaPeriod(period: QuotaPeriod, locale: string): string {
  const { unit, value } =
    period.kind === "calendar" ? { unit: period.unit, value: 1 } : rollingUnit(period.durationSeconds)
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value)
}

/**
 * זמן יחסי-עתידי קריא ("בעוד 2 דקות" / "עכשיו") מתוך epoch-ms כבר-מנורמל.
 * לא קורא Date.parse ואינו מכיר ISO של ספק — הקורא (Claude normalizer) כבר
 * המיר ל-epoch-ms.
 * @param epochMs  זמן היעד (איפוס עתידי), epoch-ms.
 * @param locale   קוד locale — מ-i18n, לא hardcode.
 * @param now      epoch-ms נוכחי; ברירת מחדל Date.now(). מוזרק לדטרמיניזם בטסט.
 */
export function formatTimeUntil(epochMs: number, locale: string, now?: number): string {
  const currentMs = now ?? Date.now()
  const diff = epochMs - currentMs

  // עבר/clock skew (זמן היעד כבר חלף) → 0, בלי מספר שלילי.
  const clampedDiff = diff < 0 ? 0 : diff

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })

  const seconds = Math.floor(clampedDiff / 1_000)
  const minutes = Math.floor(clampedDiff / 60_000)
  const hours = Math.floor(clampedDiff / 3_600_000)
  const days = Math.floor(clampedDiff / 86_400_000)

  if (clampedDiff < 1_000) {
    return rtf.format(0, "second")
  } else if (seconds < 60) {
    return rtf.format(seconds, "second")
  } else if (minutes < 60) {
    return rtf.format(minutes, "minute")
  } else if (hours < 24) {
    return rtf.format(hours, "hour")
  } else {
    return rtf.format(days, "day")
  }
}
