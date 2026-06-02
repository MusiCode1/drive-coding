/**
 * cache-headers.test.ts — integration tests עבור בוני ה-headers של הקאש (Slice 24).
 *
 * בודק:
 *   - narrateCacheHeaders: x-cache-key נכון, meta מכיל toolCallId
 *   - translateCacheHeaders: x-cache-key נכון, meta מכיל textHash
 *   - ttsCacheHeaders: x-cache-key נכון, meta מכיל voiceId + textHash
 *   - messageId = null → לא ב-meta (אופציונלי)
 *   - דטרמיניזם: אותם inputs → אותם headers
 */

import { describe, expect, it } from "vitest"
import { narrateCacheHeaders, translateCacheHeaders, ttsCacheHeaders } from "./cache-headers"

describe("narrateCacheHeaders", () => {
  it("returns correct x-cache-key format", async () => {
    const headers = await narrateCacheHeaders("toolu_018b-abc123", "bash")
    expect(headers["x-cache-key"]).toBe("narrate:toolu_018b-abc123")
  })

  it("meta contains type=narrate + toolCallId", async () => {
    const headers = await narrateCacheHeaders("toolu_018b-abc123", "bash")
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.type).toBe("narrate")
    expect(meta.toolCallId).toBe("toolu_018b-abc123")
    expect(meta.toolKind).toBe("bash")
  })

  it("meta contains createdAt (number)", async () => {
    const before = Date.now()
    const headers = await narrateCacheHeaders("toolu_id", undefined)
    const after = Date.now()
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.createdAt).toBeGreaterThanOrEqual(before)
    expect(meta.createdAt).toBeLessThanOrEqual(after)
  })

  it("empty toolCallId → returns empty headers (no key)", async () => {
    const headers = await narrateCacheHeaders("", undefined)
    expect(Object.keys(headers)).toHaveLength(0)
  })

  it("is deterministic for same toolCallId", async () => {
    const h1 = await narrateCacheHeaders("toolu_xyz", "file_editor")
    const h2 = await narrateCacheHeaders("toolu_xyz", "file_editor")
    expect(h1["x-cache-key"]).toBe(h2["x-cache-key"])
  })
})

describe("translateCacheHeaders", () => {
  it("key format: translate:<sha256(text|lang)>", async () => {
    const headers = await translateCacheHeaders("hello world", "he", null)
    expect(headers["x-cache-key"]).toMatch(/^translate:[0-9a-f]{64}$/)
  })

  it("is deterministic — same text+lang → same key", async () => {
    const h1 = await translateCacheHeaders("test text", "he", null)
    const h2 = await translateCacheHeaders("test text", "he", null)
    expect(h1["x-cache-key"]).toBe(h2["x-cache-key"])
  })

  it("different text → different key", async () => {
    const h1 = await translateCacheHeaders("hello", "he", null)
    const h2 = await translateCacheHeaders("world", "he", null)
    expect(h1["x-cache-key"]).not.toBe(h2["x-cache-key"])
  })

  it("different lang → different key", async () => {
    const h1 = await translateCacheHeaders("hello", "he", null)
    const h2 = await translateCacheHeaders("hello", "en", null)
    expect(h1["x-cache-key"]).not.toBe(h2["x-cache-key"])
  })

  it("messageId in meta when provided", async () => {
    const headers = await translateCacheHeaders("text", "he", "msg_abc")
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.messageId).toBe("msg_abc")
  })

  it("messageId = null → not in meta", async () => {
    const headers = await translateCacheHeaders("text", "he", null)
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.messageId).toBeUndefined()
  })

  it("meta contains textHash", async () => {
    const headers = await translateCacheHeaders("test", "he", null)
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.textHash).toMatch(/^[0-9a-f]{64}$/)
    expect(meta.type).toBe("translate")
  })
})

describe("ttsCacheHeaders", () => {
  it("key format: tts:<voiceId>:<sha256(text|modelId)>", async () => {
    const headers = await ttsCacheHeaders("hello", "EXAVITQu4vr4xnSDxMaL", "eleven_v3", null)
    expect(headers["x-cache-key"]).toMatch(/^tts:EXAVITQu4vr4xnSDxMaL:[0-9a-f]{64}$/)
  })

  it("is deterministic — same text+voice+model → same key", async () => {
    const h1 = await ttsCacheHeaders("test", "voice-id", "eleven_v3", null)
    const h2 = await ttsCacheHeaders("test", "voice-id", "eleven_v3", null)
    expect(h1["x-cache-key"]).toBe(h2["x-cache-key"])
  })

  it("different text → different key", async () => {
    const h1 = await ttsCacheHeaders("hello", "v1", "m1", null)
    const h2 = await ttsCacheHeaders("world", "v1", "m1", null)
    expect(h1["x-cache-key"]).not.toBe(h2["x-cache-key"])
  })

  it("different voiceId → different key", async () => {
    const h1 = await ttsCacheHeaders("same text", "voice-A", "m1", null)
    const h2 = await ttsCacheHeaders("same text", "voice-B", "m1", null)
    expect(h1["x-cache-key"]).not.toBe(h2["x-cache-key"])
  })

  it("meta contains type=tts + voiceId + textHash", async () => {
    const headers = await ttsCacheHeaders("hello", "voice-id", "eleven_v3", null)
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.type).toBe("tts")
    expect(meta.voiceId).toBe("voice-id")
    expect(meta.textHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("messageId = null → not in meta", async () => {
    const headers = await ttsCacheHeaders("text", "v", "m", null)
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.messageId).toBeUndefined()
  })

  it("messageId provided → in meta", async () => {
    const headers = await ttsCacheHeaders("text", "v", "m", "msg_xyz")
    const meta = JSON.parse(headers["x-cache-meta"] ?? "{}")
    expect(meta.messageId).toBe("msg_xyz")
  })

  it("empty text → returns empty headers", async () => {
    const headers = await ttsCacheHeaders("", "v", "m", null)
    expect(Object.keys(headers)).toHaveLength(0)
  })
})
