/**
 * translate.test.ts — TDD עבור Commit 3: יישור translate ל-withTimeout.
 *
 * בדיקת regression: translate חייב להמשיך להחזיר null בשגיאה/timeout.
 * withTimeout נmocked (כמו ב-transcribe.test.ts) כדי להימנע מ-vitest fake timers issue.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@drive-coding/core/async/with-timeout", () => ({
  withTimeout: vi.fn(),
}))

vi.mock("./sdks", () => ({
  googleAi: vi.fn().mockReturnValue("model"),
}))

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn().mockReturnValue("http://localhost:4000/proxy/google/v1beta"),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

vi.mock("@drive-coding/core/voice/translation-prompt", () => ({
  buildTranslationPrompt: vi.fn().mockReturnValue("translate this"),
}))

vi.mock("ai", () => ({
  generateObject: vi.fn(),
  jsonSchema: vi.fn().mockImplementation((s: unknown) => s),
}))

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { translate } from "./translate"
import type { VoiceModelRef } from "@drive-coding/core/voice/capabilities"

const TEST_REF: VoiceModelRef = { provider: "google", model: "gemini-flash-lite-latest" }

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>

describe("translate", () => {
  // 1. happy path — withTimeout מחזיר תוצאה תקינה
  it("מחזיר תוצאת תרגום כאשר withTimeout מצליח", async () => {
    mockWithTimeout.mockResolvedValue({
      object: { status: "translated", text: "שלום" },
    })

    const result = await translate("hello", "he", TEST_REF)
    expect(result).toEqual({ status: "translated", text: "שלום" })
  })

  // 2. timeout → null (regression: translate חייב להחזיר null, לא לזרוק)
  it("מחזיר null כאשר withTimeout זורק שגיאת timeout", async () => {
    mockWithTimeout.mockRejectedValue(new Error("translate timeout 2500ms"))

    const result = await translate("hello", "he", TEST_REF)
    expect(result).toBeNull()
  })

  // 3. שגיאה גנרית → null
  it("מחזיר null כאשר withTimeout זורק שגיאה גנרית", async () => {
    mockWithTimeout.mockRejectedValue(new Error("network error"))

    const result = await translate("hello", "he", TEST_REF)
    expect(result).toBeNull()
  })

  // 4. already_in_target
  it("מחזיר already_in_target כאשר Gemini מדווח שהטקסט בשפת היעד", async () => {
    mockWithTimeout.mockResolvedValue({
      object: { status: "already_in_target" },
    })

    const result = await translate("שלום", "he", TEST_REF)
    expect(result).toEqual({ status: "already_in_target" })
  })

  // 5. טקסט ריק → null
  it("מחזיר null כאשר translate מחזיר טקסט ריק", async () => {
    mockWithTimeout.mockResolvedValue({
      object: { status: "translated", text: "   " },
    })

    const result = await translate("hello", "he", TEST_REF)
    expect(result).toBeNull()
  })
})
