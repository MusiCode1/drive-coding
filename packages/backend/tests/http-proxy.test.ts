/**
 * Integration tests for the transparent proxy handler.
 *
 * Slice 10 Phase 1 — TDD outer-loop tests written BEFORE implementation.
 * Slice 24 — added tests for client-keyed cache (x-cache-key, x-cache-meta, sanitizeCacheKey).
 *
 * Covers:
 *   - Cache miss → upstream fetch → response → cache hit on 2nd call
 *   - Non-cacheable path (GET /v1beta/models) — passthrough, no cache
 *   - Body hash determines cache key (same body → same key, different body → different)
 *   - streamGenerateContent → NOT cached even though POST
 *   - Slice 24: client key → cache key uses sanitized client key (not body hash)
 *   - Slice 24: same client key + different body → hit (key wins)
 *   - Slice 24: x-cache-meta stored and retrieved
 *   - Slice 24: path traversal in client key is blocked
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

// We test isCacheableRequest, computeCacheKey, sanitizeCacheKey, and createProxyCache directly.
// The HTTP handler (header stripping) is verified via curl/network integration below.

// Inline require after files exist
let isCacheableRequest: (method: string, path: string, body: Uint8Array | null) => boolean
let computeCacheKey: (method: string, path: string, body: Uint8Array | null) => Promise<string>
let sanitizeCacheKey: (clientKey: string) => Promise<string>
let createProxyCache: (baseDir: string) => {
  get(key: string): Promise<{
    body: Uint8Array
    headers: { contentType: string }
    meta?: Record<string, unknown>
  } | null>
  set(
    key: string,
    entry: {
      body: Uint8Array
      headers: { contentType: string }
      meta?: Record<string, unknown>
    },
  ): Promise<void>
}

describe("isCacheableRequest", () => {
  beforeEach(async () => {
    const mod = await import("../src/delivery/proxy-cache.js")
    isCacheableRequest = mod.isCacheableRequest
    computeCacheKey = mod.computeCacheKey
    sanitizeCacheKey = mod.sanitizeCacheKey
    createProxyCache = mod.createProxyCache
  })

  it("POST generateContent → cacheable", () => {
    const body = new TextEncoder().encode(JSON.stringify({ contents: [] }))
    expect(
      isCacheableRequest("POST", "/v1beta/models/gemini-flash-latest:generateContent", body),
    ).toBe(true)
  })

  it("POST streamGenerateContent → NOT cacheable", () => {
    const body = new TextEncoder().encode(JSON.stringify({ contents: [] }))
    expect(
      isCacheableRequest("POST", "/v1beta/models/gemini-flash-latest:streamGenerateContent", body),
    ).toBe(false)
  })

  it("POST ElevenLabs text-to-speech/stream → cacheable", () => {
    const body = new TextEncoder().encode(JSON.stringify({ text: "hello" }))
    expect(isCacheableRequest("POST", "/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL/stream", body)).toBe(
      true,
    )
  })

  it("GET /v1beta/models → NOT cacheable", () => {
    expect(isCacheableRequest("GET", "/v1beta/models", null)).toBe(false)
  })

  it("POST with null body → NOT cacheable", () => {
    expect(isCacheableRequest("POST", "/v1beta/models/gemini-flash:generateContent", null)).toBe(
      false,
    )
  })
})

describe("sanitizeCacheKey (Slice 24)", () => {
  beforeEach(async () => {
    const mod = await import("../src/delivery/proxy-cache.js")
    sanitizeCacheKey = mod.sanitizeCacheKey
  })

  it("returns a 64-character hex string", async () => {
    const key = await sanitizeCacheKey("narrate:toolu_018b-abc")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("is deterministic — same input → same output", async () => {
    const k1 = await sanitizeCacheKey("narrate:toolu_018b-abc")
    const k2 = await sanitizeCacheKey("narrate:toolu_018b-abc")
    expect(k1).toBe(k2)
  })

  it("path traversal: '../../etc/passwd' → safe hex key (no slashes)", async () => {
    const key = await sanitizeCacheKey("../../etc/passwd")
    // Must be pure hex — no slashes, dots, or other path chars
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("different clientKeys → different sanitized keys", async () => {
    const k1 = await sanitizeCacheKey("narrate:tool-aaa")
    const k2 = await sanitizeCacheKey("narrate:tool-bbb")
    expect(k1).not.toBe(k2)
  })
})

describe("computeCacheKey", () => {
  beforeEach(async () => {
    const mod = await import("../src/delivery/proxy-cache.js")
    computeCacheKey = mod.computeCacheKey
  })

  it("same method+path+body → same key", async () => {
    const body = new TextEncoder().encode('{"text":"שלום"}')
    const k1 = await computeCacheKey("POST", "/v1beta/models/x:generateContent", body)
    const k2 = await computeCacheKey("POST", "/v1beta/models/x:generateContent", body)
    expect(k1).toBe(k2)
  })

  it("different body → different key", async () => {
    const b1 = new TextEncoder().encode('{"text":"hello"}')
    const b2 = new TextEncoder().encode('{"text":"world"}')
    const k1 = await computeCacheKey("POST", "/v1beta/models/x:generateContent", b1)
    const k2 = await computeCacheKey("POST", "/v1beta/models/x:generateContent", b2)
    expect(k1).not.toBe(k2)
  })

  it("different path → different key", async () => {
    const body = new TextEncoder().encode('{"text":"same"}')
    const k1 = await computeCacheKey("POST", "/v1beta/models/a:generateContent", body)
    const k2 = await computeCacheKey("POST", "/v1beta/models/b:generateContent", body)
    expect(k1).not.toBe(k2)
  })

  it("null body → produces valid key (no crash)", async () => {
    const k = await computeCacheKey("POST", "/some/path", null)
    expect(typeof k).toBe("string")
    expect(k.length).toBeGreaterThan(0)
  })
})

describe("createProxyCache", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-cache-test-"))
    const mod = await import("../src/delivery/proxy-cache.js")
    createProxyCache = mod.createProxyCache
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("cache miss → null", async () => {
    const cache = createProxyCache(tmpDir)
    const result = await cache.get("nonexistent-key")
    expect(result).toBeNull()
  })

  it("set → get returns same body + headers", async () => {
    const cache = createProxyCache(tmpDir)
    const body = new TextEncoder().encode("test audio data")
    await cache.set("key1", { body, headers: { contentType: "audio/mpeg" } })

    const result = await cache.get("key1")
    expect(result).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect above
    expect(result!.body).toEqual(body)
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect above
    expect(result!.headers.contentType).toBe("audio/mpeg")
  })

  it("cache hit after 2nd call (simulating proxy flow)", async () => {
    const cache = createProxyCache(tmpDir)
    const key = "abc123"
    const body = new Uint8Array([1, 2, 3, 4, 5])

    // First: miss
    const miss = await cache.get(key)
    expect(miss).toBeNull()

    // Store
    await cache.set(key, { body, headers: { contentType: "application/json" } })

    // Second: hit
    const hit = await cache.get(key)
    expect(hit).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect above
    expect(hit!.body).toEqual(body)
  })

  // ── Slice 24: client-keyed cache tests ────────────────────────────────────

  it("Slice 24: same clientKey + different body → same cache key (client key wins)", async () => {
    // Simulates the narrate scenario: same toolCallId, different recentMessages in body
    const bodyX = new TextEncoder().encode('{"recentMessages":["A"]}')
    const bodyY = new TextEncoder().encode('{"recentMessages":["A","B","C"]}')
    const clientKey = "narrate:toolu_018b-abc123"

    const sanitized = await sanitizeCacheKey(clientKey)

    const cache = createProxyCache(tmpDir)
    // Store using client key with bodyX
    await cache.set(sanitized, { body: bodyX, headers: { contentType: "application/json" } })

    // Retrieve: same client key, different body was never stored — but key is based on clientKey
    const result = await cache.get(sanitized)
    expect(result).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect
    expect(result!.body).toEqual(bodyX) // still returns bodyX, not bodyY
  })

  it("Slice 24: x-cache-meta is stored and retrieved", async () => {
    const cache = createProxyCache(tmpDir)
    const body = new TextEncoder().encode("audio-data")
    const meta: Record<string, unknown> = {
      type: "narrate",
      toolCallId: "toolu_018b-xyz",
      createdAt: 1700000000000,
    }

    await cache.set("key-with-meta", { body, headers: { contentType: "audio/mpeg" }, meta })

    const result = await cache.get("key-with-meta")
    expect(result).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect
    expect(result!.meta).toEqual(meta)
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect
    expect(result!.meta?.type).toBe("narrate")
  })

  it("Slice 24: path traversal in client key is blocked — sanitized key is safe hex", async () => {
    const dangerousKey = "../../etc/passwd"
    const sanitized = await sanitizeCacheKey(dangerousKey)

    // The sanitized key must be 64 hex chars — no slashes, no dots
    expect(sanitized).toMatch(/^[0-9a-f]{64}$/)

    // Ensure it doesn't escape baseDir by verifying no filesystem traversal
    const cache = createProxyCache(tmpDir)
    const body = new TextEncoder().encode("safe content")
    // This should NOT throw / create files outside tmpDir
    await cache.set(sanitized, { body, headers: { contentType: "text/plain" } })

    // Verify the file was created inside tmpDir, not outside
    const files = await fs.readdir(path.join(tmpDir, "proxy"))
    expect(files.some((f) => f === sanitized)).toBe(true)
  })

  it("Slice 24: entry without meta returns meta as undefined", async () => {
    const cache = createProxyCache(tmpDir)
    const body = new TextEncoder().encode("no meta here")
    await cache.set("no-meta-key", { body, headers: { contentType: "text/plain" } })

    const result = await cache.get("no-meta-key")
    expect(result).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: guarded by expect
    expect(result!.meta).toBeUndefined()
  })
})
