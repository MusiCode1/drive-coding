/**
 * with-retry.test.ts — TDD עבור withRetry helper.
 *
 * 6 טסטים:
 *  1. happy path — fn מצליח בנסיון 1, נקרא פעם אחת, מחזיר ערך.
 *  2. retry-then-success — fn נכשל פעם אחת ואז מצליח, נקרא פעמיים.
 *  3. exhausted — fn תמיד נכשל, retries=3, נקרא 3 פעמים, זורק שגיאה אחרונה.
 *  4. backoff timing — השהיות: base, base*2, base*4 (capped ל-max).
 *  5. shouldRetry=false — fn נכשל עם שגיאה ש-shouldRetry דוחה → זורק מיד.
 *  6. signal abort — signal.abort() באמצע ה-sleep → זורק, fn לא נקרא שוב.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { withRetry } from "../../src/async/with-retry"

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. happy path
  it("מחזיר ערך כאשר fn מצליח בנסיון הראשון", async () => {
    const fn = vi.fn().mockResolvedValue("hello")
    const result = await withRetry(fn)
    expect(result).toBe("hello")
    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith(0)
  })

  // 2. retry-then-success
  it("מנסה שוב כאשר fn נכשל פעם אחת ואז מצליח", async () => {
    let callCount = 0
    const fn = vi.fn().mockImplementation(async (attempt: number) => {
      callCount++
      if (attempt === 0) throw new Error("first failure")
      return "success"
    })

    const baseDelayMs = 100
    const promise = withRetry(fn, { retries: 3, baseDelayMs, maxDelayMs: 10000 })
    // רשום .catch לפני advance — מניעת unhandled rejection
    void promise.catch(() => {})

    // fn נכשל פעם ראשונה → ממתין baseDelayMs לפני הנסיון השני
    await vi.advanceTimersByTimeAsync(baseDelayMs)

    const result = await promise
    expect(result).toBe("success")
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, 0)
    expect(fn).toHaveBeenNthCalledWith(2, 1)
  })

  // 3. exhausted
  it("זורק את השגיאה האחרונה לאחר מיצוי כל הנסיונות", async () => {
    const lastError = new Error("final failure")
    let attempt = 0
    const fn = vi.fn().mockImplementation(async () => {
      const err = new Error(`failure ${attempt}`)
      if (attempt === 2) {
        // הנסיון האחרון — זרוק שגיאה שונה
        attempt++
        throw lastError
      }
      attempt++
      throw err
    })

    const baseDelayMs = 100
    const maxDelayMs = 1000
    const promise = withRetry(fn, { retries: 3, baseDelayMs, maxDelayMs })
    void promise.catch(() => {})

    // ממתין לכל ה-retry delays: 100, 200, 400 (capped ל-1000)
    await vi.advanceTimersByTimeAsync(baseDelayMs * 10)

    await expect(promise).rejects.toThrow("final failure")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  // 4. backoff timing — בדיקת השהיות exponential עם cap
  it("מממש backoff אקספוננציאלי עם תקרה", async () => {
    const delays: number[] = []
    let lastTime = 0
    const baseDelayMs = 100
    const maxDelayMs = 350

    let callNum = 0
    const fn = vi.fn().mockImplementation(async () => {
      const now = vi.getMockedSystemTime()?.valueOf() ?? 0
      if (callNum > 0) {
        delays.push(now - lastTime)
      }
      lastTime = now
      callNum++
      throw new Error("always fail")
    })

    const promise = withRetry(fn, { retries: 4, baseDelayMs, maxDelayMs })
    void promise.catch(() => {})

    // advance מספיק לכל הnסיונות
    await vi.advanceTimersByTimeAsync(10000)

    await expect(promise).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(4)

    // השהיות: 100, 200, 350(=capped 400)
    expect(delays[0]).toBe(100)   // attempt 0→1: base*2^0 = 100
    expect(delays[1]).toBe(200)   // attempt 1→2: base*2^1 = 200
    expect(delays[2]).toBe(350)   // attempt 2→3: base*2^2 = 400 → capped ל-350
  })

  // 5. shouldRetry=false — זורק מיד בלי retry
  it("זורק מיד כאשר shouldRetry מחזיר false", async () => {
    const specificError = new Error("do not retry")
    const fn = vi.fn().mockRejectedValue(specificError)

    const promise = withRetry(fn, {
      retries: 3,
      shouldRetry: (err) => err !== specificError,
    })

    await expect(promise).rejects.toThrow("do not retry")
    expect(fn).toHaveBeenCalledOnce()
  })

  // 6. signal abort — קוטע גם את ה-sleep
  it("קוטע את ה-retry sleep כאשר signal.abort() נקרא", async () => {
    const ac = new AbortController()
    let callCount = 0
    const fn = vi.fn().mockImplementation(async () => {
      callCount++
      throw new Error("fail")
    })

    const promise = withRetry(fn, {
      retries: 3,
      baseDelayMs: 1000,
      signal: ac.signal,
    })
    void promise.catch(() => {})

    // fn נקרא פעם אחת, ממתין 1000ms לפני הנסיון השני
    await Promise.resolve() // microtask לאחר fn הראשון
    // מבטל את ה-signal — צריך לחתוך את ה-sleep
    ac.abort()

    // אפשר לadvance מעט (פחות מ-1000ms)
    await vi.advanceTimersByTimeAsync(10)

    await expect(promise).rejects.toThrow()
    // fn נקרא פעם אחת בלבד (הaborting קטע את ה-sleep לפני הנסיון השני)
    expect(fn).toHaveBeenCalledOnce()
  })
})
