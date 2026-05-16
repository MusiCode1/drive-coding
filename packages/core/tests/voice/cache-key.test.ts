import { describe, expect, it } from "vitest"
import { cacheKeyFor } from "../../src/voice/cache-key"

describe("cacheKeyFor", () => {
  it("returns a 64-character hex string", async () => {
    const key = await cacheKeyFor("hello", "voice-1", "model-1")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("is deterministic — same inputs give same key", async () => {
    const k1 = await cacheKeyFor("שלום עולם", "elevenlabs-v3", "eleven_v3")
    const k2 = await cacheKeyFor("שלום עולם", "elevenlabs-v3", "eleven_v3")
    expect(k1).toBe(k2)
  })

  it("differs for different text", async () => {
    const k1 = await cacheKeyFor("שלום", "v1", "m1")
    const k2 = await cacheKeyFor("עולם", "v1", "m1")
    expect(k1).not.toBe(k2)
  })

  it("differs for different voiceId", async () => {
    const k1 = await cacheKeyFor("hello", "voice-A", "model-1")
    const k2 = await cacheKeyFor("hello", "voice-B", "model-1")
    expect(k1).not.toBe(k2)
  })

  it("differs for different modelId", async () => {
    const k1 = await cacheKeyFor("hello", "voice-1", "model-A")
    const k2 = await cacheKeyFor("hello", "voice-1", "model-B")
    expect(k1).not.toBe(k2)
  })

  it("handles empty text", async () => {
    const key = await cacheKeyFor("", "voice-1", "model-1")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("handles unicode text", async () => {
    const key = await cacheKeyFor("ברוך אתה ה'", "v3", "eleven_v3")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
