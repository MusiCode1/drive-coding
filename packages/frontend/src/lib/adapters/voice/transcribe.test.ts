/**
 * transcribe.test.ts — TDD עבור transcribe עם withTimeout + withRetry.
 *
 * 3 טסטים:
 *  1. happy path — generateContent מחזיר text מהר → transcribe מחזיר { text, recordingId }.
 *  2. retry — generateContent זורק פעם אחת ואז מצליח → transcribe מחזיר text, נקרא פעמיים.
 *  3. exhausted — תמיד זורק → transcribe זורק אחרי 3 נסיונות.
 *
 * הערה על גישת הטסטים:
 *  - withTimeout ו-withRetry מוmockים כי vi.useFakeTimers ב-jsdom יוצר race conditions.
 *  - הלוגיקה של timeout/retry גופה נבדקת ב-packages/core/tests/async/.
 *  - הטסט כאן מאמת שה-throw של withTimeout/withRetry מתפשט ל-caller.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@drive-coding/core/async/with-timeout", () => ({
  withTimeout: vi.fn(),
}))

vi.mock("@drive-coding/core/async/with-retry", () => ({
  withRetry: vi.fn(),
}))

vi.mock("./sdks", () => ({
  googleGenAi: vi.fn(),
}))

vi.mock("./base64", () => ({
  bytesToBase64: vi.fn().mockReturnValue("AAAA"),
}))

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn().mockReturnValue("http://localhost:4000/proxy/google/"),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { withRetry } from "@drive-coding/core/async/with-retry"
import { transcribe } from "./transcribe"

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>
const mockWithRetry = withRetry as ReturnType<typeof vi.fn>

describe("transcribe", () => {
  // 1. happy path — generateContent מצליח → transcribe מחזיר text
  it("מחזיר text ו-recordingId כאשר generateContent מגיב מהר", async () => {
    // withRetry קורא ל-fn שלו, withTimeout קורא ל-fn שלו
    mockWithRetry.mockImplementation(
      async (fn: (attempt: number) => Promise<unknown>) => {
        return fn(0)
      },
    )
    mockWithTimeout.mockImplementation(
      async (fn: (signal: AbortSignal) => Promise<unknown>) => {
        return fn(new AbortController().signal)
      },
    )

    const mockGenContent = vi.fn().mockResolvedValue({ text: "שלום" })
    const { googleGenAi } = await import("./sdks")
    ;(googleGenAi as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: mockGenContent },
    })

    const blob = new Blob(["audio"], { type: "audio/webm" })
    const result = await transcribe(blob)

    expect(result.text).toBe("שלום")
    expect(result.recordingId).toBe("")
    // וודא TRANSCRIBE_TIMEOUT_MS === 30000
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      30000,
      expect.objectContaining({ label: "transcribe" }),
    )
    // וודא שwithRetry נקרא עם 3 retries + label transcribe
    expect(mockWithRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ retries: 3, label: "transcribe" }),
    )
  })

  // 2. retry — generateContent זורק פעם, ואז withRetry קורא ל-fn שוב ומצליח
  it("מנסה שוב כאשר generateContent זורק פעם אחת ואז מצליח", async () => {
    let callCount = 0
    // withRetry: קורא ל-fn 2 פעמים — פעם ראשונה זורק, פעם שניה מחזיר
    mockWithRetry.mockImplementation(
      async (fn: (attempt: number) => Promise<unknown>) => {
        callCount++
        if (callCount === 1) {
          // סימולציה: זרוק פעם ראשונה, נסה שוב
          try {
            await fn(0)
          } catch {
            // retry
          }
          return fn(1) // נסיון שני — מצליח
        }
        return fn(0)
      },
    )
    // withTimeout תמיד קורא ל-fn שלו
    mockWithTimeout.mockImplementation(
      async (fn: (signal: AbortSignal) => Promise<unknown>) => {
        return fn(new AbortController().signal)
      },
    )

    let genCallCount = 0
    const mockGenContent = vi.fn().mockImplementation(async () => {
      genCallCount++
      if (genCallCount === 1) throw new Error("socket error")
      return { text: "הצלחה" }
    })
    const { googleGenAi } = await import("./sdks")
    ;(googleGenAi as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: mockGenContent },
    })

    const blob = new Blob(["audio"], { type: "audio/webm" })
    const result = await transcribe(blob)

    expect(result.text).toBe("הצלחה")
    expect(genCallCount).toBe(2)
  })

  // 3. exhausted — תמיד זורק → transcribe זורק
  it("דוחה כאשר withRetry זורק (מיצוי נסיונות)", async () => {
    mockWithRetry.mockRejectedValue(new Error("transcribe failed after 3 retries"))

    const blob = new Blob(["audio"], { type: "audio/webm" })
    await expect(transcribe(blob)).rejects.toThrow("transcribe failed after 3 retries")
  })
})
