/**
 * snapshot-timeout.ts — ‏כמה זמן `SSEReader` ‏ממתין ל-snapshot ‏frame-zero,
 * ‏**וכיצד המשתמש דורס זאת מהדפדפן** ‏בלי בנייה מחדש ובלי דגל-בנייה.
 *
 * ‏שני ערוצים, ‏בסדר הזה:
 *
 * ```js
 * // ‏1. ‏גלובל — ‏מיָדי, ‏ולא שורד רענון
 * window.__dcSnapshotTimeoutMs = 300000   // ‏5 ‏דקות
 * window.__dcSnapshotTimeoutMs = 0        // ‏ללא הגבלה
 * // ‏2. ‏localStorage — ‏שורד רענון, ‏וזה הערוץ שבאמת עוזר
 * localStorage.setItem("dc:snapshotTimeoutMs", "0")
 * ```
 *
 * ‏🔑 **‏למה שני ערוצים ולא רק גלובל:** ‏הכשל קורה **‏בזמן החיבור**, ‏כלומר
 * ‏בדרך-כלל מיד אחרי רענון — ‏וגלובל שהוגדר ב-console ‏נמחק ברענון. ‏גלובל לבדו
 * ‏היה מנגנון שאי-אפשר להשתמש בו בדיוק ברגע שבו הוא נחוץ.
 *
 * ‏🛑 **‏"‏ללא הגבלה" ‏הוא 24.8 ‏יום, ‏לא אינסוף — ‏וזאת בכוונה.** ‏`setTimeout`
 * ‏מוגדר ב-HTML ‏על `long`, ‏ולכן ערך מעל `2^31-1` ‏**‏גולש ונורה מיָד**. ‏נמדד
 * ‏ב-Node: ‏`2147483647` ‏לא נורה; ‏`2147483648` ‏ו-`Infinity` ‏נורו שניהם תוך
 * ‏2ms ‏עם `TimeoutOverflowWarning: Timeout duration was set to 1`. ‏⇒ ‏מי
 * ‏שמעביר `Infinity` ‏כדי "‏לבטל" ‏את הגבול מקבל טיימאאוט **‏מיידי**, ‏ההפך
 * ‏המדויק מכוונתו. ‏ה-clamp ‏כאן הוא מה שמונע את המלכודת הזאת.
 *
 * ‏⚠️ **‏ומה שהעקיפה הזאת מחזירה:** ‏הגבול נוסף כי חיבור שנפתח ואינו שולח
 * ‏`snapshot` ‏תולה את `#connectOnce` ‏לנצח — ‏מחוץ לטווח-הראייה של
 * ‏גלאי-השתיקה (‏שמתחיל רק **‏אחרי** ‏ה-snapshot) ‏ושל לולאת-החיבור-מחדש.
 * ‏עם "‏ללא הגבלה" ‏המצב הזה נראה כמו טעינה שנמשכת, ‏בלי שגיאה ובלי retry.
 * ‏זה ערוץ-ניפוי, ‏לא ברירת-מחדל.
 */

/** ‏ברירת-המחדל. ‏ר' ‏`sse-reader.ts` ‏למה הגבול קיים מלכתחילה. */
export const SNAPSHOT_TIMEOUT_MS = 60_000

/** ‏`2^31-1` ‏— ‏התקרה שמעליה `setTimeout` ‏גולש ונורה מיָד (‏נמדד, ‏ר' ‏למעלה). */
export const MAX_TIMER_MS = 2_147_483_647

/** ‏מפתח ה-localStorage ‏לעקיפה שעמידה לרענון. */
export const SNAPSHOT_TIMEOUT_KEY = "dc:snapshotTimeoutMs"

/**
 * ‏מנרמל ערך-עקיפה גולמי (‏מגלובל או מ-localStorage) ‏למילישניות.
 *
 * ‏`0` ‏· ‏`"off"` ‏· ‏`"never"` ‏· ‏`"none"` ‏· ‏מספר שלילי ‏· ‏`Infinity` ⇒ ‏`MAX_TIMER_MS`.
 * ‏זבל (`"abc"`, ‏`{}`, ‏`NaN`) ⇒ ‏ברירת-המחדל — ‏**‏לא** ‏אפס, ‏כדי ששגיאת-הקלדה
 * ‏לא תהפוך בשקט לטיימאאוט מיידי.
 */
export function resolveSnapshotTimeoutMs(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return SNAPSHOT_TIMEOUT_MS
  if (typeof raw === "string") {
    const key = raw.trim().toLowerCase()
    if (key === "off" || key === "never" || key === "none" || key === "unlimited")
      return MAX_TIMER_MS
  }
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN
  if (Number.isNaN(n)) return SNAPSHOT_TIMEOUT_MS
  if (n <= 0 || !Number.isFinite(n)) return MAX_TIMER_MS
  return Math.min(n, MAX_TIMER_MS)
}

/**
 * ‏קורא את העקיפה מהדפדפן: ‏גלובל קודם, ‏אחריו localStorage, ‏ואם אין — ‏ברירת-מחדל.
 *
 * ‏`localStorage` ‏עטוף ב-try: ‏ב-SSR ‏הוא נעדר, ‏ובמצבי-פרטיות הגישה **‏זורקת**
 * ‏(‏ולא מחזירה null) ‏— ‏וחיבור SSE ‏לא אמור ליפול בגלל הגדרת-דפדפן.
 */
export function readSnapshotTimeoutMs(): number {
  const g = (globalThis as { __dcSnapshotTimeoutMs?: unknown }).__dcSnapshotTimeoutMs
  if (g !== null && g !== undefined && g !== "") return resolveSnapshotTimeoutMs(g)
  try {
    const stored = globalThis.localStorage?.getItem(SNAPSHOT_TIMEOUT_KEY)
    if (stored !== null && stored !== undefined) return resolveSnapshotTimeoutMs(stored)
  } catch {
    // ‏גישה חסומה — ‏ברירת-מחדל, ‏בשקט
  }
  return SNAPSHOT_TIMEOUT_MS
}
