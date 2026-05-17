import { describe, expect, it } from "vitest"
import { isEnabledForNs } from "../../src/log/namespace.js"

describe("isEnabledForNs", () => {
  it("* matches everything", () => {
    expect(isEnabledForNs("voice", "*")).toBe(true)
    expect(isEnabledForNs("voice.pipeline", "*")).toBe(true)
    expect(isEnabledForNs("backend.server", "*")).toBe(true)
  })

  it("voice.* matches voice, voice.pipeline, voice.pipeline.tts", () => {
    expect(isEnabledForNs("voice", "voice.*")).toBe(true)
    expect(isEnabledForNs("voice.pipeline", "voice.*")).toBe(true)
    expect(isEnabledForNs("voice.pipeline.tts", "voice.*")).toBe(true)
  })

  it("voice.* does NOT match voicemail (prefix guard)", () => {
    expect(isEnabledForNs("voicemail", "voice.*")).toBe(false)
    expect(isEnabledForNs("voiceover.something", "voice.*")).toBe(false)
  })

  it("voice.pipeline (exact) matches only exact, not sub-namespaces", () => {
    expect(isEnabledForNs("voice.pipeline", "voice.pipeline")).toBe(true)
    expect(isEnabledForNs("voice.pipeline.tts", "voice.pipeline")).toBe(false)
    expect(isEnabledForNs("voice", "voice.pipeline")).toBe(false)
  })

  it("-noisy.x excludes — stronger than include", () => {
    expect(isEnabledForNs("noisy.x", "*,-noisy.x")).toBe(false)
    expect(isEnabledForNs("noisy.x.sub", "*,-noisy.x.*")).toBe(false)
    expect(isEnabledForNs("other", "*,-noisy.x")).toBe(true)
  })

  it("combined: voice.*,acp.*,-acp.heartbeat", () => {
    expect(isEnabledForNs("voice.pipeline", "voice.*,acp.*,-acp.heartbeat")).toBe(true)
    expect(isEnabledForNs("acp.transport", "voice.*,acp.*,-acp.heartbeat")).toBe(true)
    expect(isEnabledForNs("acp.heartbeat", "voice.*,acp.*,-acp.heartbeat")).toBe(false)
    expect(isEnabledForNs("backend.server", "voice.*,acp.*,-acp.heartbeat")).toBe(false)
  })

  it("empty pattern → match all", () => {
    expect(isEnabledForNs("voice.pipeline", "")).toBe(true)
    expect(isEnabledForNs("anything", "   ")).toBe(true)
  })

  it("exclude-only pattern → only excluded ns fails", () => {
    expect(isEnabledForNs("voice", "-noisy.*")).toBe(true)
    expect(isEnabledForNs("noisy.x", "-noisy.*")).toBe(false)
  })
})
