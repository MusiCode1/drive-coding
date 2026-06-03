/**
 * with-retry.ts — מריץ פונקציה אסינכרונית עם retry ו-exponential backoff.
 *
 * דפוס מקביל ל-with-timeout.ts (אותה תיקייה) — ה-helper האחיד לכל retry בפרויקט.
 *
 * שלושה דברים שקל לשכוח:
 *  ① ה-sleep חייב להיות בר-ביטול ע"י signal — clearTimeout ב-finally + listener לביטול מוקדם.
 *  ② shouldRetry(err)===false → זרוק מיד, אל תנסה שוב.
 *  ③ signal.aborted בכניסה → זרוק מיד לפני כל ניסיון.
 */

export type RetryOptions = {
  /** מספר נסיונות מקסימלי (כולל הראשון). ברירת מחדל 3. */
  retries?: number
  /** השהיה בסיסית (ms) לפני הנסיון השני. מוכפלת אקספוננציאלית. ברירת מחדל 500. */
  baseDelayMs?: number
  /** תקרת השהיה (ms). ברירת מחדל 5000. */
  maxDelayMs?: number
  /** signal לביטול חיצוני — קוטע גם את ה-fn וגם את ה-sleep בין נסיונות. */
  signal?: AbortSignal
  /** מחזיר true אם השגיאה ראויה ל-retry. ברירת מחדל: כל שגיאה (() => true). */
  shouldRetry?: (err: unknown) => boolean
  /** label ללוג. */
  label?: string
}

/**
 * מריץ את fn עד retries פעמים. בכשל — ממתין delay (exponential: base*2^attempt,
 * capped ל-max) ומנסה שוב. אם כל הנסיונות נכשלו — זורק את השגיאה האחרונה.
 * signal.abort קוטע מיד (זורק AbortError / DOMException). אם shouldRetry מחזיר
 * false — זורק מיד בלי retry.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const retries = opts?.retries ?? 3
  const baseDelayMs = opts?.baseDelayMs ?? 500
  const maxDelayMs = opts?.maxDelayMs ?? 5000
  const signal = opts?.signal
  const shouldRetry = opts?.shouldRetry ?? (() => true)
  const label = opts?.label ?? "withRetry"

  // בדיקה מוקדמת — אם signal כבר aborted
  if (signal?.aborted) {
    throw new DOMException(`${label} aborted`, "AbortError")
  }

  let lastError: unknown

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (err: unknown) {
      lastError = err

      // בדוק אם זה abort error
      if (signal?.aborted) {
        throw err
      }

      // shouldRetry=false → זרוק מיד
      if (!shouldRetry(err)) {
        throw err
      }

      // הנסיון האחרון — זרוק בלי sleep
      if (attempt >= retries - 1) {
        break
      }

      // חשב delay: base * 2^attempt, capped ל-max
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)

      // ① sleep בר-ביטול — Promise שמאזין ל-signal ול-timer
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined

        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException(`${label} aborted during retry sleep`, "AbortError"))
        }

        if (signal?.aborted) {
          reject(new DOMException(`${label} aborted`, "AbortError"))
          return
        }

        signal?.addEventListener("abort", onAbort, { once: true })

        timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort)
          resolve()
        }, delay)
      })

      // אחרי ה-sleep — בדוק שוב (למקרה שה-signal בוטל)
      if (signal?.aborted) {
        throw new DOMException(`${label} aborted`, "AbortError")
      }
    }
  }

  throw lastError
}
