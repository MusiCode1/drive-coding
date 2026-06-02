/**
 * with-timeout.ts — עוטף פעולה אסינכרונית ב-timeout.
 *
 * עובד בשני מצבים:
 *  - SDK שמכבד AbortSignal: ה-fn מעביר את ה-signal הלאה → ביטול-רשת אמיתי.
 *  - SDK שמתעלם מ-AbortSignal: ה-Promise.race דוחה אחרי ms בכל מקרה → משחרר את ה-await.
 *
 * שני הדברים שקל לשכוח בהעתקה ידנית:
 *  ① void work.catch(()=>{}) + void timeout.catch(()=>{}) — מונע unhandled rejection
 *    של הצד המפסיד ב-race. ה-.catch נרשם **לפני** ה-timer/fn כדי להבטיח שאין tick gap.
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

  // יצירת timeout promise עם reject function נגיש מחוץ לconstructor —
  // כך אפשר לרשום .catch() לפני שה-timer ירה (מניעת tick gap ב-unhandledRejection)
  let timeoutReject!: (e: Error) => void
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutReject = reject
  })

  // ① רשום .catch על שני הצדדים **לפני** שה-timer ו-fn מתחילים —
  //    מונע unhandled rejection של הצד המפסיד ב-race, גם אם הוא דוחה
  //    לאחר tick אחד (vitest fake timers, setImmediate callbacks).
  void timeout.catch(() => {})

  // הפעל את ה-timer עכשיו — handler כבר מחובר
  timer = setTimeout(() => {
    ac.abort() // best-effort: לקטוע את הבקשה ברשת אם ה-SDK תומך
    timeoutReject(new Error(`${opts?.label ?? "operation"} timeout ${ms}ms`))
  }, ms)

  const work = fn(ac.signal)
  // ① (המשך) — בולע גם rejection של work (הצד המפסיד כשה-timeout ניצח)
  void work.catch(() => {})

  try {
    return await Promise.race([work, timeout])
  } finally {
    // ② מנקה את ה-timer לכל כיוון — אם work ניצח, ה-setTimeout לא צריך לירות.
    clearTimeout(timer)
  }
}
