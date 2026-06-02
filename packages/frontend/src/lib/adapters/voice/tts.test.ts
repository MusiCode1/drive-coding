/**
 * tts.test.ts — TDD עבור Commit 2: withTimeout ב-synthesizeStreaming.
 *
 * הנקודה הקריטית: withTimeout עוטף רק את ה-fetch (connect/headers).
 * ה-stream (response.body) מוחזר **אחרי** שה-withTimeout resolve — לא נקטע.
 *
 * גישת הטסטים:
 *  - withTimeout מוcked (כמו transcribe.test.ts).
 *  - בודקים: stream מוחזר, timeout דוחה, streaming-safety (body מוחזר מחוץ ל-withTimeout).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@drive-coding/core/async/with-timeout", () => ({
  withTimeout: vi.fn(),
}))

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn((path: string) => `http://localhost:4000${path}`),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { synthesizeStreaming } from "./tts"

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>

const passthroughWithTimeout = async (fn: (signal: AbortSignal) => Promise<unknown>) =>
  fn(new AbortController().signal)

beforeEach(() => {
  vi.resetAllMocks()
})

describe("synthesizeStreaming", () => {
  it("happy path — מחזיר ReadableStream מה-response.body", async () => {
    // יצירת stream מדומה
    const fakeStream = new ReadableStream()
    const fakeResponse = {
      ok: true,
      body: fakeStream,
      text: async () => "",
    }
    // withTimeout מחזיר את ה-response (לא את ה-stream עצמו — זהו הדפוס הקריטי)
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse))

    const result = await synthesizeStreaming({
      text: "שלום עולם",
      voiceId: "voice-1",
    })

    expect(result).toBe(fakeStream)
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ label: "tts-connect" }),
    )
  })

  it("streaming safety: withTimeout מקבל את ה-fetch (לא את response.body)", async () => {
    // בדיקה שה-withTimeout עוטף **רק** את ה-fetch — ה-stream מוחזר אחריו
    const fakeStream = new ReadableStream()
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body: fakeStream }),
    )

    const result = await synthesizeStreaming({ text: "test", voiceId: "v1" })

    // ה-withTimeout קיבל פונקציה (ה-fetch) — לא את ה-stream ישירות
    const [fn, ms] = mockWithTimeout.mock.calls[0] as [unknown, number]
    expect(typeof fn).toBe("function") // fn = (s) => fetch(...)
    expect(ms).toBe(10000)
    // התוצאה היא ה-stream — מחוץ לscope של withTimeout
    expect(result).toBe(fakeStream)
  })

  it("signal חיצוני מועבר ל-withTimeout", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    const fakeStream = new ReadableStream()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body: fakeStream }),
    )

    const ac = new AbortController()
    await synthesizeStreaming({ text: "test", voiceId: "v1", signal: ac.signal })

    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ signal: ac.signal }),
    )
  })

  it("timeout — withTimeout זורק → synthesizeStreaming זורק", async () => {
    mockWithTimeout.mockRejectedValue(new Error("tts-connect timeout 10000ms"))

    await expect(
      synthesizeStreaming({ text: "שלום", voiceId: "v1" }),
    ).rejects.toThrow("tts-connect timeout 10000ms")
  })

  it("שגיאת HTTP — response.ok=false → זורק TTS failed", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      }),
    )

    await expect(
      synthesizeStreaming({ text: "שלום", voiceId: "v1" }),
    ).rejects.toThrow("TTS failed: 429 rate limited")
  })

  it("response.body=null → זורק 'no body'", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body: null }),
    )

    await expect(
      synthesizeStreaming({ text: "שלום", voiceId: "v1" }),
    ).rejects.toThrow("TTS: no body in response")
  })
})
