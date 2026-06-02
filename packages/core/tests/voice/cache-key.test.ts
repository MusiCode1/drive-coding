import { describe, expect, it } from "vitest"
import { cacheKeyFor, sha256Key } from "../../src/voice/cache-key"

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

describe("sha256Key", () => {
  it("returns a 64-character hex string", async () => {
    const key = await sha256Key("abc")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("is deterministic — known value for 'abc'", async () => {
    // SHA-256("abc") computed by crypto.subtle — verified against actual output
    const key = await sha256Key("abc")
    expect(key).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  it("is deterministic — same input gives same output", async () => {
    const k1 = await sha256Key("narrate:tool-123")
    const k2 = await sha256Key("narrate:tool-123")
    expect(k1).toBe(k2)
  })

  it("differs for different inputs", async () => {
    const k1 = await sha256Key("translate:abc|he")
    const k2 = await sha256Key("translate:xyz|he")
    expect(k1).not.toBe(k2)
  })

  it("handles empty string", async () => {
    const key = await sha256Key("")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
