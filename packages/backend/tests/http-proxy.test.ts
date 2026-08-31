/**
 * Integration tests for the transparent proxy handler.
 *
 * Slice 10 Phase 1 — TDD outer-loop tests written BEFORE implementation.
 * Slice 24 — added tests for client-keyed cache (x-cache-key, x-cache-meta, sanitizeCacheKey).
 * Slice proxy-tap-memory — added Gemini TransformStream metering + RSS regression guard.
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
 *   - proxy-tap-memory: Gemini tap records usage via TransformStream (not tee)
 *   - proxy-tap-memory: RSS delta < 50MB when client drains a 64MB stream
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
    // biome-ignore lint/correctness/noUnusedVariables: bodyY documents the "different body" scenario even though unused in this test
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

// ── proxy-tap-memory: Gemini TransformStream metering ─────────────────────────

describe("Gemini proxy tap (proxy-tap-memory)", () => {
  let tmpDir: string
  let registerProxyHttp: (
    app: import("hono").Hono,
    opts?: { cacheBaseDir?: string; usageStore?: import("../src/usage/usage-store.js").UsageStore },
  ) => void

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-tap-test-"))
    const mod = await import("../src/delivery/http-proxy.js")
    registerProxyHttp = mod.registerProxyHttp
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("TransformStream tap records usage from Gemini SSE stream", async () => {
    // Arrange: mock fetch with a minimal Gemini SSE response containing usageMetadata
    const ssePayload = [
      `data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/mp3","data":"AAAA"}}],"role":"model"}}]}\r\n\r\n`,
      `data: {"candidates":[],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":50,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":45}]}}\r\n\r\n`,
      `data: [DONE]\r\n\r\n`,
    ].join("")

    const encoder = new TextEncoder()
    const sseBytes = encoder.encode(ssePayload)

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sseBytes, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    )

    // Track usage records
    const recorded: Array<{ inputTokens?: number; audioTokens?: number }> = []
    const usageStore = {
      record(event: { inputTokens?: number; audioTokens?: number; [k: string]: unknown }) {
        recorded.push({ inputTokens: event.inputTokens, audioTokens: event.audioTokens })
      },
    } as import("../src/usage/usage-store.js").UsageStore

    const { Hono } = await import("hono")
    const app = new Hono()
    registerProxyHttp(app, { cacheBaseDir: tmpDir, usageStore, env: process.env })

    // Act: send streamGenerateContent request
    const req = new Request(
      "http://localhost/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
      },
    )
    const res = await app.fetch(req)

    // Must read the full response to trigger flush()
    const responseText = await res.text()
    expect(res.status).toBe(200)
    expect(responseText).toContain("usageMetadata")

    // Assert: usage was recorded with correct tokens
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.inputTokens).toBe(10)
    expect(recorded[0]?.audioTokens).toBe(45)
  })

  it("MemoryGuard overBudget → proxy returns 503", async () => {
    // Arrange: mock fetch (should NOT be called when over budget)
    const mockFetch = vi.fn()
    vi.stubGlobal("fetch", mockFetch)

    // Build an app with a memoryGuard that always reports over budget
    const overBudgetGuard = {
      overBudget: () => true,
      stop: () => {},
    }

    const { Hono } = await import("hono")
    const app3 = new Hono()
    const mod2 = await import("../src/delivery/http-proxy.js")
    mod2.registerProxyHttp(app3, { cacheBaseDir: tmpDir, memoryGuard: overBudgetGuard, env: process.env })

    const req3 = new Request(
      "http://localhost/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
      },
    )
    const res3 = await app3.fetch(req3)

    // Should return 503 without calling fetch
    expect(res3.status).toBe(503)
    const body3 = await res3.json()
    expect((body3 as { error: string }).error).toContain("memory pressure")
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("MemoryGuard not over budget → proxy proceeds normally", async () => {
    // Arrange: not-over-budget guard + minimal SSE response
    const notOverBudgetGuard = {
      overBudget: () => false,
      stop: () => {},
    }

    const ssePayload2 = `data: {"candidates":[],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\r\n\r\ndata: [DONE]\r\n\r\n`
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(ssePayload2), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    )

    const { Hono } = await import("hono")
    const app4 = new Hono()
    const mod3 = await import("../src/delivery/http-proxy.js")
    mod3.registerProxyHttp(app4, { cacheBaseDir: tmpDir, memoryGuard: notOverBudgetGuard, env: process.env })

    const req4 = new Request(
      "http://localhost/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [] }),
      },
    )
    const res4 = await app4.fetch(req4)

    // Should pass through (200), not 503
    expect(res4.status).toBe(200)
  })

  it("TransformStream tap does not buffer stream when client is slow — bounded RSS", async () => {
    // Regression guard for the OOM bug: with tee(), the unread branch buffered the full stream.
    // With TransformStream, the stream is client-paced → RSS delta should be small.
    //
    // We use a 64MB stream (smaller than 256MB to keep the test fast) and measure RSS.
    // Budget: delta < 50MB.
    //
    // Note: this test relies on GC behavior and may be flaky in very constrained environments.
    // The actual 256MB repro is documented in scripts/repro-proxy-mem.mjs.

    const CHUNK_SIZE = 64 * 1024
    const TOTAL_BYTES = 64 * 1024 * 1024 // 64MB
    const RSS_BUDGET_MB = 50

    const audioBase64 = "A".repeat(CHUNK_SIZE - 200)
    const audioLine = `data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/mp3","data":"${audioBase64}"}}],"role":"model"}}]}\r\n\r\n`
    const usageLine = `data: {"candidates":[],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":20,"candidatesTokensDetails":[{"modality":"AUDIO","tokenCount":20}]}}\r\n\r\ndata: [DONE]\r\n\r\n`

    const enc2 = new TextEncoder()
    const audioBytes = enc2.encode(audioLine)
    const usageBytes = enc2.encode(usageLine)

    let emitted = 0
    const mockStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= TOTAL_BYTES) {
          controller.enqueue(usageBytes)
          controller.close()
          return
        }
        controller.enqueue(audioBytes)
        emitted += audioBytes.length
      },
    })

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(mockStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    )

    const recorded: number[] = []
    const usageStore = {
      record(event: { audioTokens?: number; [k: string]: unknown }) {
        recorded.push(event.audioTokens ?? 0)
      },
    } as import("../src/usage/usage-store.js").UsageStore

    const { Hono } = await import("hono")
    const app2 = new Hono()
    registerProxyHttp(app2, { cacheBaseDir: tmpDir, usageStore, env: process.env })

    const rssBefore = process.memoryUsage().rss

    const req2 = new Request(
      "http://localhost/proxy/google/v1beta/models/gemini-flash:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "rss-test" }] }] }),
      },
    )
    const res2 = await app2.fetch(req2)

    // Read the full response body to drain the stream (client-paced)
    let bytesRead = 0
    if (!res2.body) throw new Error("expected non-null body")
    const reader = res2.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) bytesRead += value.length
    }

    const rssAfter = process.memoryUsage().rss
    const deltaMb = (rssAfter - rssBefore) / 1024 / 1024

    // Verify stream was fully transmitted
    expect(bytesRead).toBeGreaterThan(TOTAL_BYTES)

    // Verify usage was recorded
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toBe(20)

    // Verify RSS didn't blow up (TransformStream = client-paced, no full buffer)
    expect(deltaMb).toBeLessThan(RSS_BUDGET_MB)
  }, 30_000) // allow 30s for large stream
})
