/**
 * liveness-thresholds.ts — **מקום אחד** לכל ספי-החיוּת של ה-FE.
 *
 * 🔴 למה הקובץ הזה קיים (אביגיל, ממצא 3): הסלייס `stream-liveness` הכניס סף
 * שלישי (75ש׳) לצד שניים קיימים (90ש׳ · 5ש׳), **ושלושתם יורים על אותו אירוע**
 * — "משהו לא זז". הם נכתבו בשלושה סלייסים שונים, בשלושה קבצים, בלי שאיש ראה
 * את השלושה יחד. סף רביעי שייכתב באותה דרך ייצור התנגשות שאיש לא ישים לב אליה.
 *
 * ⚠️ **הם מודדים דברים שונים, ולכן אינם מתמזגים לאחד** — אבל הם **חייבים
 * להיות מסודרים**, וזו ההכרעה שהקובץ הזה מקבע:
 *
 * ```
 *  5ש׳   באנר-נוכחות     "הבקשה נכשלת"        ← רשת מול השרת
 * 75ש׳   שתיקת-זרם       "הצינור מת"          ← תעבורה
 * 90ש׳   תור ששקע        "הסוכן לא מדבר"      ← אפליקציה
 * 600ש׳  תקרת-תור        "מספיק, זה תקוע"     ← גג
 * ```
 *
 * **סדר-הגודל הוא התוכן:** כל שכבה חייבת לירות **אחרי** זו שמתחתיה, אחרת
 * היא מאשימה במקום הלא-נכון. שתיקת-זרם לפני באנר-נוכחות = "הצינור מת" בזמן
 * שהאמת היא "הרשת נופלת". תור-ששקע לפני שתיקת-זרם = "הסוכן חושב" בזמן
 * שבכלל אין חיבור.
 *
 * ⚠️ **75 < 90 אינו מקרי ואסור להפוך אותו:** ניתוק-תעבורה חייב להיתפס לפני
 * שהמשתמשת מקבלת הודעה שהסוכן שקע — אחרת נאשים את הסוכן בתקלת-רשת.
 */

/** ה-keepalive שהשרת פולט (`session-host/http/events.ts`). הנחה על התנהגות השרת. */
export const SERVER_KEEPALIVE_MS = 30_000

/** 5ש׳ — חסד לפני שמטרידים את המשתמשת על כשל-בקשה חולף. */
export const PRESENCE_BANNER_DELAY_MS = 5_000

/** 75ש׳ — 2.5 מחזורי-keepalive. סובלני לאיבוד אחד, לא לשניים. */
export const STREAM_STALE_MS = SERVER_KEEPALIVE_MS * 2.5

/** 90ש׳ — תור בלי שום פעילות. **חייב להיות אחרי** `STREAM_STALE_MS`. */
export const TURN_STALL_NOTICE_MS = 90_000

/** 600ש׳ — גג עליון לתור, נמדד מתחילתו. */
export const TURN_STALL_HARD_CAP_MS = 600_000

/**
 * שומר-הסדר. נקרא מטסט — כך שהפרה מפילה build ולא מתגלה בשדה.
 * מוחזר מערך של הפרות (ריק = תקין).
 */
export function checkThresholdOrder(): string[] {
  const errors: string[] = []
  if (!(PRESENCE_BANNER_DELAY_MS < STREAM_STALE_MS)) {
    errors.push("PRESENCE_BANNER_DELAY_MS must be < STREAM_STALE_MS")
  }
  if (!(STREAM_STALE_MS < TURN_STALL_NOTICE_MS)) {
    errors.push("STREAM_STALE_MS must be < TURN_STALL_NOTICE_MS")
  }
  if (!(TURN_STALL_NOTICE_MS < TURN_STALL_HARD_CAP_MS)) {
    errors.push("TURN_STALL_NOTICE_MS must be < TURN_STALL_HARD_CAP_MS")
  }
  return errors
}
