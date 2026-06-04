/**
 * recordings.test.ts — TDD עבור saveRecording + recordingUrl.
 *
 * saveRecording זורק על תגובת-שגיאה (כדי ש-withRetry בשכבה הקוראת ינסה שוב),
 * ומחזיר { id } על הצלחה. ה-retry/backoff עצמו נבדק ב-core/tests/async; כאן
 * מאמתים שהפונקציה זורקת/מחזירה נכון ושומרת על חוזה ה-BE (JSON, לא body גולמי).
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn((path: string) => `http://localhost:4000${path}`),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

vi.mock("./base64", () => ({
  bytesToBase64: vi.fn().mockReturnValue("QUFB"),
}))

import { recordingUrl, saveRecording } from "./recordings"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("saveRecording", () => {
  it("שולח JSON { audioBase64, mimeType } ומחזיר { id } על 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "rec-123" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const blob = new Blob(["audio"], { type: "audio/webm" })
    const result = await saveRecording(blob)

    expect(result).toEqual({ id: "rec-123" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error("fetch not called")
    const [url, init] = call as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe("http://localhost:4000/api/recordings")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ audioBase64: "QUFB", mimeType: "audio/webm" })
  })

  it("זורק כאשר השרת מחזיר שגיאה — כדי שה-retry בשכבה הקוראת יתפוס", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal("fetch", fetchMock)

    const blob = new Blob(["audio"], { type: "audio/webm" })
    await expect(saveRecording(blob)).rejects.toThrow("saveRecording failed: 503")
  })

  it("מעביר signal ל-fetch כשמסופק", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) })
    vi.stubGlobal("fetch", fetchMock)

    const ctrl = new AbortController()
    const blob = new Blob(["a"], { type: "audio/webm" })
    await saveRecording(blob, { signal: ctrl.signal })

    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error("fetch not called")
    expect((call[1] as RequestInit).signal).toBe(ctrl.signal)
  })

  it("נופל ל-audio/webm כשל-blob אין type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "y" }) })
    vi.stubGlobal("fetch", fetchMock)

    const blob = new Blob(["a"]) // ללא type
    await saveRecording(blob)

    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error("fetch not called")
    expect(JSON.parse((call[1] as RequestInit).body as string).mimeType).toBe("audio/webm")
  })
})

describe("recordingUrl", () => {
  it("בונה URL ל-GET /api/recordings/:id", () => {
    expect(recordingUrl("abc")).toBe("http://localhost:4000/api/recordings/abc")
  })
})
