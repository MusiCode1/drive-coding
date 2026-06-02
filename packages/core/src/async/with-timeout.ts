/**
 * with-timeout.ts — עוטף פעולה אסינכרונית ב-timeout.
 *
 * עובד בשני מצבים:
 *  - SDK שמכבד AbortSignal: ה-fn מעביר את ה-signal הלאה → ביטול-רשת אמיתי.
 *  - SDK שמתעלם מ-AbortSignal: ה-Promise.race דוחה אחרי ms בכל מקרה → משחרר את ה-await.
 *
 * שני הדברים שקל לשכוח בהעתקה ידנית:
 *  ① void work.catch(()=>{}) — מונע unhandled rejection של הצד המפסיד ב-race.
 *  ② clearTimeout ב-finally — מנקה timer לכל כיוון (אם work ניצח, ה-timer לא ירה).
 */

/**
 * עוטף פעולה אסינכרונית ב-timeout. עובד בשני מצבים:
 *  - SDK שמכבד AbortSignal: ה-fn מעביר את ה-signal הלאה → ביטול-רשת אמיתי.
 *  - SDK שמתעלם מ-AbortSignal: ה-Promise.race דוחה אחרי ms בכל מקרה → משחרר את ה-await.
 * זורק (rejects) עם Error("...timeout...") כשהזמן עובר.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  opts?: { signal?: AbortSignal; label?: string },
): Promise<T> {
  const ac = new AbortController()
  opts?.signal?.addEventListener("abort", () => ac.abort(), { once: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort() // best-effort: לקטוע את הבקשה ברשת אם ה-SDK תומך
      reject(new Error(`${opts?.label ?? "operation"} timeout ${ms}ms`))
    }, ms)
  })

  const work = fn(ac.signal)
  // ① בולע rejection של הצד שמפסיד ב-race — מונע unhandled rejection
  //    כש-ה-SDK דוחה (AbortError) אחרי שה-timeout כבר ניצח.
  //    ה-reference המקורי (work) עדיין מועבר ל-race, אז הקורא מקבל את השגיאה אם work מפסיד.
  void work.catch(() => {})

  try {
    return await Promise.race([work, timeout])
  } finally {
    // ② מנקה את ה-timer לכל כיוון — אם work ניצח, ה-setTimeout לא צריך לירות.
    clearTimeout(timer)
  }
}
