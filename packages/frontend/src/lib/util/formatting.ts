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
