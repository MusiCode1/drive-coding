/**
 * select.test.ts — TDD עבור Commit 0: VoiceConfig + select() טהורה.
 *
 * בדיקות:
 * 1. select("translate", DEFAULT_VOICE_CONFIG) → { provider: "google", model: "gemini-flash-lite-latest" }
 * 2. select("narrate", DEFAULT_VOICE_CONFIG) → אותו ref
 * 3. select("stt", ...) → { provider: "google", model: "gemini-flash-latest" }
 * 4. select("tts", ...) → { provider: "elevenlabs", model: "eleven_v3" }
 * 5. config מותאם → מוחזר כמו-שהוא (ללא override)
 * 6. (אופציונלי) voiceConfig() של ArkType דוחה shape לא-תקין
 */
import { describe, expect, it } from "vitest"
import { select } from "./select"
import { DEFAULT_VOICE_CONFIG, voiceConfig } from "./capabilities"

describe("select()", () => {
  it("מחזיר translate ref מ-DEFAULT_VOICE_CONFIG", () => {
    expect(select("translate", DEFAULT_VOICE_CONFIG)).toEqual({
      provider: "google",
      model: "gemini-flash-lite-latest",
    })
  })

  it("מחזיר narrate ref מ-DEFAULT_VOICE_CONFIG", () => {
    expect(select("narrate", DEFAULT_VOICE_CONFIG)).toEqual({
      provider: "google",
      model: "gemini-flash-lite-latest",
    })
  })

  it("מחזיר stt ref מ-DEFAULT_VOICE_CONFIG", () => {
    expect(select("stt", DEFAULT_VOICE_CONFIG)).toEqual({
      provider: "google",
      model: "gemini-flash-latest",
    })
  })

  it("מחזיר tts ref מ-DEFAULT_VOICE_CONFIG", () => {
    expect(select("tts", DEFAULT_VOICE_CONFIG)).toEqual({
      provider: "elevenlabs",
      model: "eleven_v3",
    })
  })

  it("מחזיר config מותאם כמו-שהוא (ללא override)", () => {
    const custom = {
      ...DEFAULT_VOICE_CONFIG,
      translate: { provider: "openai" as const, model: "gpt-4o-mini" },
    }
    expect(select("translate", custom)).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    })
  })
})

describe("voiceConfig ArkType validation", () => {
  it("דוחה shape לא-תקין (provider לא ידוע)", () => {
    const result = voiceConfig({
      translate: { provider: "unknown-provider", model: "x" },
      narrate: { provider: "google", model: "x" },
      stt: { provider: "google", model: "x" },
      tts: { provider: "elevenlabs", model: "x" },
      live: { provider: "google", model: "gemini-3.1-flash-live-preview" },
    })
    // ArkType מחזיר instance של AggregateError כש-validation נכשל
    expect(result instanceof type.errors).toBe(true)
  })
})

// import type לצורך הטסט האחרון
import { type } from "arktype"
