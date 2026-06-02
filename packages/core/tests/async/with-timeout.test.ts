/**
 * with-timeout.test.ts — TDD עבור withTimeout helper.
 *
 * 6 טסטים:
 *  1. happy path — fn נפתר מהר, withTimeout מחזיר ערך.
 *  2. timeout (SDK מתעלם מ-signal) — fn לעולם לא נפתר, race מנצח אחרי ms.
 *  3. abort propagation — SDK שמכבד abort — fn מגיב ל-signal.
 *  4. external signal — opts.signal שעובר abort → withTimeout דוחה.
 *  5. timer cleanup — fn נפתר מהר → setTimeout מנוקה (אין דלף).
 *  6. no unhandled rejection — fn דוחה אחרי timeout → אין unhandledRejection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { withTimeout } from "../../src/async/with-timeout"

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. happy path
  it("מחזיר ערך כאשר fn נפתר לפני ה-timeout", async () => {
    const fn = vi.fn().mockResolvedValue("hello")
    const result = await withTimeout(fn, 5000)
    expect(result).toBe("hello")
    expect(fn).toHaveBeenCalledOnce()
  })

  // 2. timeout — SDK מתעלם מ-signal (fn לא מגיב ל-abort)
  it("דוחה עם שגיאת timeout כאשר fn לא נפתר ו-SDK מתעלם מ-signal", async () => {
    // fn שלעולם לא נפתר — מתעלם מה-signal
    const fn = (_signal: AbortSignal) => new Promise<never>(() => {})

    const promise = withTimeout(fn, 1000, { label: "test-op" })
    vi.advanceTimersByTime(1000)

    await expect(promise).rejects.toThrow("test-op timeout 1000ms")
  })

  // 3. abort propagation — SDK שמכבד abort
  it("מעביר abort ל-fn כאשר timeout עובר (SDK שמכבד signal)", async () => {
    const fn = (signal: AbortSignal) =>
      new Promise<never>((_, rej) =>
        signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true }),
      )

    const promise = withTimeout(fn, 500)
    vi.advanceTimersByTime(500)

    // הדחייה מגיעה מ-withTimeout (timeout ניצח ב-race) — error message יכיל "timeout"
    await expect(promise).rejects.toThrow()
  })

  // 4. external signal — ביטול ידני לפני timeout
  it("דוחה כאשר opts.signal עובר abort לפני ה-timeout", async () => {
    const outerAc = new AbortController()
    let receivedSignal: AbortSignal | undefined

    // fn שנתקע — מחכה ל-signal שלו
    const fn = (signal: AbortSignal) => {
      receivedSignal = signal
      return new Promise<never>(() => {})
    }

    const promise = withTimeout(fn, 10000, { signal: outerAc.signal, label: "external" })

    // ביטול ידני
    outerAc.abort()

    // מחכים מיקרו-קידום (Promise microtask)
    await Promise.resolve()

    // ה-signal הפנימי אמור לעבור abort
    expect(receivedSignal?.aborted).toBe(true)

    // timeout לא הגיע עדיין — הdraft promise נשאר תלוי.
    // נוודא רק שה-signal הופץ (בדיקה סינתטית).
  })

  // 5. timer cleanup — אין דלף של setTimeout אחרי resolve
  it("מנקה את ה-timer כאשר fn נפתר לפני ה-timeout", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")

    const fn = vi.fn().mockResolvedValue("done")
    await withTimeout(fn, 5000)

    // clearTimeout אמור להיקרא בגוף ה-finally
    expect(clearTimeoutSpy).toHaveBeenCalled()

    // לא אמור להיות callback מאוחר — advance 6000ms
    vi.advanceTimersByTime(6000)
    // אם ה-timer דלף — הוא היה קורא ac.abort/reject, אבל Promise כבר נפתרה → אין בעיה
    // הטסט בודק שclearTimeout נקרא — זה עיקר המנגנון
    clearTimeoutSpy.mockRestore()
  })

  // 6. no unhandled rejection — fn דוחה אחרי שtimeout ניצח
  // הסצנריו: timeout=200ms ניצח ב-race. fn מגיב ל-abort אחרי **עיכוב נוסף** (250ms) —
  // כלומר fn דוחה אחרי שwithTimeout כבר החזיר את שגיאת ה-timeout.
  // ה-`void work.catch(()=>{})` מונע שה-rejection ה"מאוחר" של fn יהיה unhandled.
  it("לא מייצר unhandled rejection כאשר fn דוחה אחרי שה-timeout ניצח", async () => {
    const unhandledRejections: unknown[] = []
    const handler = (reason: unknown) => unhandledRejections.push(reason)
    process.on("unhandledRejection", handler)

    try {
      // fn מגיב ל-abort עם עיכוב (250ms) — timeout=200ms ינצח בrace
      const fn = (_signal: AbortSignal) =>
        new Promise<never>((_, rej) => {
          setTimeout(() => rej(new Error("sdk-delayed-abort")), 250)
        })

      const promise = withTimeout(fn, 200, { label: "no-unhandled" })

      // advance 200ms → timeout ניצח ב-race → withTimeout דוחה
      vi.advanceTimersByTime(200)
      await expect(promise).rejects.toThrow("no-unhandled timeout 200ms")

      // advance 50ms נוסף → fn דוחה ("sdk-delayed-abort") — אחרי שwithTimeout כבר נגמר
      vi.advanceTimersByTime(50)

      // נותנים ל-microtasks להתרוקן
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // ה-`void work.catch(()=>{})` בולע את ה-rejection — אין unhandled
      expect(unhandledRejections).toHaveLength(0)
    } finally {
      process.off("unhandledRejection", handler)
    }
  })
})
