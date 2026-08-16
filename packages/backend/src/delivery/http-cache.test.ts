/**
 * http-cache.test.ts — TDD tests for the in-memory HTTP cache (slice liveness C2).
 *
 * Testing: tdd (brief §C2)
 *
 * Tests:
 *   - get returns undefined for a missing key
 *   - set + get roundtrip
 *   - TTL expiry (fake timers) — 2 requests in window → 1 sample, after TTL → fresh
 *   - invalidateAll clears
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { httpCacheGet, httpCacheInvalidateAll, httpCacheSet } from "./http-cache.js"

beforeEach(() => {
  httpCacheInvalidateAll()
})

afterEach(() => {
  vi.useRealTimers()
  httpCacheInvalidateAll()
})

describe("http-cache", () => {
  it("get returns undefined for a missing key", () => {
    expect(httpCacheGet("nope")).toBeUndefined()
  })

  it("set + get roundtrip", () => {
    httpCacheSet("k", { a: 1 })
    expect(httpCacheGet("k")).toEqual({ a: 1 })
  })

  it("expires after the TTL (fake timers)", () => {
    vi.useFakeTimers()
    httpCacheSet("k", { a: 1 })
    expect(httpCacheGet("k")).toEqual({ a: 1 })

    // advance past the 1.5s TTL
    vi.advanceTimersByTime(1600)
    expect(httpCacheGet("k")).toBeUndefined()
  })

  it("invalidateAll clears everything", () => {
    httpCacheSet("a", 1)
    httpCacheSet("b", 2)
    httpCacheInvalidateAll()
    expect(httpCacheGet("a")).toBeUndefined()
    expect(httpCacheGet("b")).toBeUndefined()
  })
})
