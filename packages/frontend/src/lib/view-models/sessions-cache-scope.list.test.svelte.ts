/**
 * sessions-cache-scope.list.test.svelte.ts — contract tests for SessionsCacheScope.list (slice sessions-cache-scope, C1).
 */
import { describe, expect, it, vi } from "vitest"
import type { SessionInfo } from "$lib/adapters/sessions"
import { SessionsCacheScope } from "./sessions-cache-scope.svelte"

const sample: SessionInfo[] = [
  { sessionId: "a", cwd: "/x", title: "A", updatedAt: "" },
]

describe("SessionsCacheScope.list", () => {
  it("source === null is a total no-op (loading and error untouched)", async () => {
    const cache = new SessionsCacheScope()
    cache.loading = true
    cache.error = "prior"

    await cache.list(null)

    expect(cache.loading).toBe(true)
    expect(cache.error).toBe("prior")
  })

  it("skips when already loading (does not double-fetch)", async () => {
    const cache = new SessionsCacheScope()
    const source = vi.fn(async () => sample)
    cache.loading = true

    await cache.list(source)

    expect(source).not.toHaveBeenCalled()
  })

  it("uses cache after first success unless force=true", async () => {
    const cache = new SessionsCacheScope()
    const source = vi.fn(async () => sample)

    await cache.list(source)
    expect(source).toHaveBeenCalledTimes(1)
    expect(cache.sessions).toEqual(sample)

    await cache.list(source)
    expect(source).toHaveBeenCalledTimes(1)

    await cache.list(source, true)
    expect(source).toHaveBeenCalledTimes(2)
  })

  it("clears error at load start and sets loading false in finally on success", async () => {
    const cache = new SessionsCacheScope()
    cache.error = "old"
    const source = vi.fn(async () => sample)

    await cache.list(source)

    expect(cache.error).toBeNull()
    expect(cache.loading).toBe(false)
    expect(cache.sessions).toEqual(sample)
  })

  it("-32601 → empty list, error stays null, cache hit on second call", async () => {
    const cache = new SessionsCacheScope()
    const source = vi.fn(async () => {
      throw { code: -32601 }
    })

    await cache.list(source)
    expect(cache.sessions).toEqual([])
    expect(cache.error).toBeNull()
    expect(cache.loading).toBe(false)

    await cache.list(source)
    expect(source).toHaveBeenCalledTimes(1)
  })

  it("other errors call setError, keep prior sessions, and do not mark loaded", async () => {
    const cache = new SessionsCacheScope()
    cache.sessions = sample
    const fail = vi.fn(async () => {
      throw new Error("boom")
    })

    await cache.list(fail)

    expect(cache.error).toBe("boom")
    expect(cache.sessions).toEqual(sample)
    expect(cache.loading).toBe(false)

    await cache.list(fail)
    expect(fail).toHaveBeenCalledTimes(2)
  })

  it("setError normalizes non-Error rejections", () => {
    const cache = new SessionsCacheScope()
    cache.setError({ code: -32601 })
    expect(cache.error).toBe("[object Object]")
  })
})

describe("SessionsCacheScope.remove / reset", () => {
  it("remove filters optimistically", () => {
    const cache = new SessionsCacheScope()
    cache.sessions = [
      { sessionId: "keep", cwd: "/", title: "", updatedAt: "" },
      { sessionId: "drop", cwd: "/", title: "", updatedAt: "" },
    ]
    cache.remove("drop")
    expect(cache.sessions.map((s) => s.sessionId)).toEqual(["keep"])
  })

  it("reset clears list, error, and loaded flag (via list re-fetch)", async () => {
    const cache = new SessionsCacheScope()
    const source = vi.fn(async () => sample)
    await cache.list(source)
    cache.error = "x"

    cache.reset()

    expect(cache.sessions).toEqual([])
    expect(cache.error).toBeNull()
    expect(cache.loading).toBe(false)

    await cache.list(source)
    expect(source).toHaveBeenCalledTimes(2)
  })
})
