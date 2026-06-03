/**
 * narrate.test.ts — TDD עבור Commit 3: יישור narrate ל-withTimeout.
 *
 * הנקודה המרכזית: narrate חייב להמשיך להחזיר null בכל שגיאה/timeout.
 * ה-caller (Speaker) מתייחס ל-null כ"דלג על קריינות".
 *
 * גישת הטסטים:
 *  - withTimeout מוcked (כמו transcribe.test.ts).
 *  - בודקים: happy path, timeout→null, error→null.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@drive-coding/core/async/with-timeout", () => ({
  withTimeout: vi.fn(),
}))

vi.mock("ai", () => ({
  generateText: vi.fn(),
}))

vi.mock("./sdks", () => ({
  googleAi: vi.fn().mockReturnValue("mock-model"),
}))

vi.mock("@drive-coding/core/voice/narration-prompt", () => ({
  buildNarratePrompt: vi.fn().mockReturnValue("mock prompt"),
}))

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { narrate } from "./narrate"

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>

const passthroughWithTimeout = async (fn: (signal: AbortSignal) => Promise<unknown>) =>
  fn(new AbortController().signal)

beforeEach(() => {
  vi.resetAllMocks()
})

describe("narrate", () => {
  const ctx = {
    userMessage: "test",
    recentMessages: [],
  } as Parameters<typeof narrate>[0]
  const tool = {
    toolCallId: "tc-1",
    title: "read_file",
  } as Parameters<typeof narrate>[1]

  it("happy path — מחזיר טקסט כאשר generateText מצליח", async () => {
    const { generateText } = await import("ai")
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    ;(generateText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "קורא קובץ..." })

    const result = await narrate(ctx, tool)

    expect(result).toBe("קורא קובץ...")
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      3000,
      expect.objectContaining({ label: "narrate" }),
    )
  })

  it("timeout — withTimeout זורק → narrate מחזיר null (התנהגות שמורה)", async () => {
    mockWithTimeout.mockRejectedValue(new Error("narrate timeout 3000ms"))

    const result = await narrate(ctx, tool)

    expect(result).toBeNull()
  })

  it("שגיאה כלשהי → narrate מחזיר null", async () => {
    mockWithTimeout.mockRejectedValue(new Error("network error"))

    const result = await narrate(ctx, tool)

    expect(result).toBeNull()
  })

  it("טקסט ריק → מחזיר null", async () => {
    const { generateText } = await import("ai")
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    ;(generateText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "   " })

    const result = await narrate(ctx, tool)

    expect(result).toBeNull()
  })

  it("signal חיצוני מועבר ל-withTimeout", async () => {
    const { generateText } = await import("ai")
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    ;(generateText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "מריץ פקודה" })

    const ac = new AbortController()
    await narrate(ctx, tool, ac.signal)

    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      3000,
      expect.objectContaining({ signal: ac.signal }),
    )
  })
})
