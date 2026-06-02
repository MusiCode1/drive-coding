/**
 * voices.test.ts — TDD עבור Commit 2: withTimeout ב-listVoices.
 *
 * גישת הטסטים:
 *  - withTimeout מוcked (כמו transcribe.test.ts) כי vi.useFakeTimers יוצר
 *    race condition עם unhandledRejection detection של vitest@4.1.6.
 *  - לוגיקת ה-timeout מכוסה ב-with-timeout.test.ts (core).
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
import { listVoices } from "./voices"

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>

const passthroughWithTimeout = async (fn: (signal: AbortSignal) => Promise<unknown>) =>
  fn(new AbortController().signal)

beforeEach(() => {
  vi.resetAllMocks()
})

describe("listVoices", () => {
  it("happy path — מחזיר מערך קולות", async () => {
    const fakeVoices = [
      { voice_id: "v1", name: "Sarah" },
      { voice_id: "v2", name: "Adam" },
    ]
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ voices: fakeVoices }),
      }),
    )

    const result = await listVoices()

    expect(result).toEqual(fakeVoices)
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      8000,
      expect.objectContaining({ label: "listVoices" }),
    )
  })

  it("מחזיר מערך ריק כאשר voices חסר ב-JSON", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    )

    const result = await listVoices()
    expect(result).toEqual([])
  })

  it("signal חיצוני מועבר ל-withTimeout", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ voices: [] }),
      }),
    )

    const ac = new AbortController()
    await listVoices(ac.signal)

    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      8000,
      expect.objectContaining({ signal: ac.signal }),
    )
  })

  it("timeout — withTimeout זורק → listVoices זורק", async () => {
    mockWithTimeout.mockRejectedValue(new Error("listVoices timeout 8000ms"))

    await expect(listVoices()).rejects.toThrow("listVoices timeout 8000ms")
  })

  it("שגיאת HTTP — fetch ok=false → זורק עם status", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      }),
    )

    await expect(listVoices()).rejects.toThrow("listVoices failed: 401 unauthorized")
  })
})
