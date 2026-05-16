import { describe, expect, it } from "vitest"
import {
  DEFAULT_REGISTRIES,
  STT_REGISTRY,
  TRANSLATOR_REGISTRY,
  TTS_REGISTRY,
} from "../src/voice/providers"

describe("voice provider registries", () => {
  it("STT_REGISTRY has 'gemini/flash-context'", () => {
    expect(STT_REGISTRY["gemini/flash-context"]).toBeDefined()
    expect(STT_REGISTRY["gemini/flash-context"].specificationVersion).toBe("v3")
  })

  it("TTS_REGISTRY has 'elevenlabs/v3'", () => {
    expect(TTS_REGISTRY["elevenlabs/v3"]).toBeDefined()
    // ElevenLabs speech model — must have a modelId
    expect(TTS_REGISTRY["elevenlabs/v3"].modelId).toBeTruthy()
  })

  it("TRANSLATOR_REGISTRY has 'gemini/flash-lite'", () => {
    expect(TRANSLATOR_REGISTRY["gemini/flash-lite"]).toBeDefined()
  })

  it("DEFAULT_REGISTRIES wires all three", () => {
    expect(DEFAULT_REGISTRIES.stt).toBe(STT_REGISTRY)
    expect(DEFAULT_REGISTRIES.tts).toBe(TTS_REGISTRY)
    expect(DEFAULT_REGISTRIES.translator).toBe(TRANSLATOR_REGISTRY)
  })
})
