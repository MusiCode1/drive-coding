/**
 * tts-resolve.test.ts — TDD עבור resolveTts (Commit 0).
 *
 * בודק:
 *  - "google" → geminiTts + "Kore" + "gemini-3.1-flash-tts-preview"
 *  - "elevenlabs" → elevenLabsTts + voiceId מועבר + "eleven_v3"
 *  - format מתאים לכל ספק ("pcm" / "mp3")
 *  - V4b: פרמטר geminiVoice אופציונלי — ברירת מחדל "Kore", ניתן לשינוי
 */
import { describe, expect, it, vi } from "vitest"
import { resolveTts } from "./tts-resolve"
import { GEMINI_VOICES } from "./voices-gemini"
import { elevenLabsTts } from "./tts"
import { geminiTts } from "./tts-gemini"

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn((path: string) => `http://localhost:4000${path}`),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

describe("resolveTts", () => {
  it('google → geminiTts + "Kore" + gemini-model', () => {
    const result = resolveTts("google", "some-voice-id")
    expect(result.provider).toBe(geminiTts)
    expect(result.voiceId).toBe("Kore")
    expect(result.modelId).toBe("gemini-3.1-flash-tts-preview")
  })

  it("google → provider.format = pcm", () => {
    const result = resolveTts("google", "any")
    expect(result.provider.format).toBe("pcm")
  })

  it('elevenlabs → elevenLabsTts + voiceId מועבר + "eleven_v3"', () => {
    const result = resolveTts("elevenlabs", "rachel")
    expect(result.provider).toBe(elevenLabsTts)
    expect(result.voiceId).toBe("rachel")
    expect(result.modelId).toBe("eleven_v3")
  })

  it("elevenlabs → provider.format = mp3", () => {
    const result = resolveTts("elevenlabs", "any")
    expect(result.provider.format).toBe("mp3")
  })

  it("elevenlabs — voiceId מועבר כמו שהוא (לא מוחלף ב-Kore)", () => {
    const result = resolveTts("elevenlabs", "custom-voice-xyz")
    expect(result.voiceId).toBe("custom-voice-xyz")
  })

  // ─── V4b: geminiVoice parameter ───

  it("(א) google ללא geminiVoice → voiceId=Kore (תאימות-לאחור)", () => {
    const result = resolveTts("google", "ignored")
    expect(result.voiceId).toBe("Kore")
  })

  it('(ב) google עם geminiVoice="Puck" → voiceId=Puck', () => {
    const result = resolveTts("google", "ignored", "Puck")
    expect(result.voiceId).toBe("Puck")
  })

  it("(ג) elevenlabs לא מושפע מ-geminiVoice", () => {
    const result = resolveTts("elevenlabs", "rachel", "Puck")
    expect(result.voiceId).toBe("rachel")
    expect(result.provider).toBe(elevenLabsTts)
  })

  it("(ד) GEMINI_VOICES.length === 30 וכולל Kore", () => {
    expect(GEMINI_VOICES).toHaveLength(30)
    expect(GEMINI_VOICES.some((v) => v.id === "Kore")).toBe(true)
  })
})
