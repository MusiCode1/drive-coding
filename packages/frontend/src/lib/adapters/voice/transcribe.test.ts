/**
 * transcribe.test.ts — TDD עבור F3: transcribe עם withTimeout.
 *
 * 2 טסטים:
 *  1. happy path — generateContent מחזיר text מהר → transcribe מחזיר { text, recordingId }.
 *  2. timeout — withTimeout דוחה (מדומה) → transcribe דוחה (F3 סגור).
 *
 * הערה על גישת הטסטים:
 *  - withTimeout עצמו נmock כאן כי vi.useFakeTimers ב-jsdom יוצר race condition
 *    עם unhandledRejection detection של vitest@4.1.6 (PromiseRejectionHandledWarning).
 *  - הlogi של timeout גופו נbדק ב-packages/core/tests/async/with-timeout.test.ts.
 *  - הטסט כאן מאמת שה-throw של withTimeout מתפשט ל-caller (mic.svelte.ts catch).
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@drive-coding/core/async/with-timeout", () => ({
  withTimeout: vi.fn(),
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
import { transcribe } from "./transcribe"

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>

describe("transcribe", () => {
  // 1. happy path
  it("מחזיר text ו-recordingId כאשר generateContent מגיב מהר", async () => {
    // withTimeout קורא ל-fn ומחזיר את תוצאתו
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
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      15000,
      expect.objectContaining({ label: "transcribe" }),
    )
  })

  // 2. timeout — מאמת F3 סגור: withTimeout זורק → transcribe זורק
  it("דוחה כאשר withTimeout זורק שגיאת timeout (F3)", async () => {
    mockWithTimeout.mockRejectedValue(new Error("transcribe timeout 15000ms"))

    const blob = new Blob(["audio"], { type: "audio/webm" })
    await expect(transcribe(blob)).rejects.toThrow("transcribe timeout 15000ms")
  })
})
