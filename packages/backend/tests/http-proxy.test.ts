/**
 * Integration tests for the transparent proxy handler.
 *
 * Slice 10 Phase 1 — TDD outer-loop tests written BEFORE implementation.
 *
 * Covers:
 *   - Cache miss → upstream fetch → response → cache hit on 2nd call
 *   - Non-cacheable path (GET /v1beta/models) — passthrough, no cache
 *   - Body hash determines cache key (same body → same key, different body → different)
 *   - streamGenerateContent → NOT cached even though POST
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

// We test isCacheableRequest, computeCacheKey, and createProxyCache directly.
// The HTTP handler is tested via server integration (manual / CRIT-5 concern).

// Inline require after files exist
let isCacheableRequest: (method: string, path: string, body: Uint8Array | null) => boolean
let computeCacheKey: (method: string, path: string, body: Uint8Array | null) => Promise<string>
let createProxyCache: (baseDir: string) => {
  get(key: string): Promise<{ body: Uint8Array; headers: { contentType: string } } | null>
  set(key: string, entry: { body: Uint8Array; headers: { contentType: string } }): Promise<void>
}

describe("isCacheableRequest", () => {
  beforeEach(async () => {
    const mod = await import("../src/delivery/proxy-cache.js")
    isCacheableRequest = mod.isCacheableRequest
    computeCacheKey = mod.computeCacheKey
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
})
