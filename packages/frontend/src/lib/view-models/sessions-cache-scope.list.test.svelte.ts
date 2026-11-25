import type { SessionListCapabilities, SessionListQuery } from "@drive-coding/core/session"
import { describe, expect, it, vi } from "vitest"
import type { SessionListPage } from "$lib/adapters/sessions"
import { SessionsCacheScope } from "./sessions-cache-scope.svelte"

const supported = { list: true, filterByCwd: true, delete: true }
const withoutDelete = { ...supported, delete: false }

function page(
  ids: string[],
  nextCursor?: string,
  capabilities: SessionListCapabilities | null = supported,
): SessionListPage {
  return {
    sessions: ids.map((id) => ({ sessionId: id, cwd: "/fixture", title: id, updatedAt: "" })),
    nextCursor,
    capabilities,
    legacyCanDelete: false,
  }
}

function source(initial = page([])) {
  return {
    listSessions: vi
      .fn<(query?: SessionListQuery) => Promise<SessionListPage>>()
      .mockResolvedValue(initial),
  }
}

function ids(cache: SessionsCacheScope) {
  return cache.sessions.items.map((item) => item.sessionId)
}

describe("SessionsCacheScope", () => {
  it("uses the same cwd after append, refresh and the next append", async () => {
    const cache = new SessionsCacheScope()
    const view = source()
    view.listSessions
      .mockResolvedValueOnce(page(["a"], "old"))
      .mockResolvedValueOnce(page(["b"]))
      .mockResolvedValueOnce(page(["a"], "new"))
      .mockResolvedValueOnce(page(["c"]))

    await cache.list(view, false, { cwd: "/fixture" })
    await cache.list(view, false, { cwd: "/fixture" })
    await cache.loadMore(view)
    await cache.list(view, true, { cwd: "/fixture" })
    await cache.loadMore(view)

    expect(view.listSessions.mock.calls).toEqual([
      [{ cwd: "/fixture" }],
      [{ cwd: "/fixture", cursor: "old" }],
      [{ cwd: "/fixture" }],
      [{ cwd: "/fixture", cursor: "new" }],
    ])
    expect(ids(cache)).toEqual(["a", "c"])
  })

  it("deduplicates double clicks and rows, keeps the first version, and stops on a consumed cursor", async () => {
    const cache = new SessionsCacheScope()
    const view = source(page(["a"], "loop"))
    await cache.list(view)
    const result = Promise.withResolvers<SessionListPage>()
    view.listSessions.mockReturnValueOnce(result.promise)
    const append = cache.loadMore(view)
    await cache.loadMore(view)
    const next = page(["a", "b", "b"], "loop")
    next.sessions[0] = { sessionId: "a", cwd: "/changed", title: "changed", updatedAt: "" }
    result.resolve(next)
    await append
    await cache.loadMore(view)

    expect(view.listSessions).toHaveBeenCalledTimes(2)
    expect(ids(cache)).toEqual(["a", "b"])
    expect(cache.sessions.items[0]?.title).toBe("a")
    expect(cache.sessions.nextCursor).toBeUndefined()
  })

  it("retains rows and the empty cursor for manual retry, even after an empty page", async () => {
    const cache = new SessionsCacheScope()
    const view = source(page([], ""))
    await cache.list(view, false, { cwd: "/fixture" })
    view.listSessions.mockRejectedValueOnce(new Error("append failed"))
    await cache.loadMore(view)
    expect(cache.sessions.nextCursor).toBe("")
    expect(cache.error).toBe("append failed")
    expect(cache.loading).toBe(false)

    view.listSessions.mockResolvedValueOnce(page(["second"]))
    await cache.loadMore(view)
    expect(view.listSessions.mock.calls.slice(1)).toEqual([
      [{ cwd: "/fixture", cursor: "" }],
      [{ cwd: "/fixture", cursor: "" }],
    ])
    expect(ids(cache)).toEqual(["second"])
    expect(cache.error).toBeNull()
  })

  it.each([false, true])("drops old append completion after B (reject=%s)", async (reject) => {
    const cache = new SessionsCacheScope()
    const view = source(page(["a"], "cursor-a"))
    await cache.list(view, false, { cwd: "/a" })
    const result = Promise.withResolvers<SessionListPage>()
    view.listSessions
      .mockReturnValueOnce(result.promise)
      .mockResolvedValueOnce(page(["b"], "cursor-b", withoutDelete))
    const append = cache.loadMore(view)
    await cache.list(view, false, { cwd: "/b" })
    if (reject) result.reject(new Error("old error"))
    else result.resolve(page(["late"], "late-cursor"))

    await append
    expect(ids(cache)).toEqual(["b"])
    expect(cache.sessions.nextCursor).toBe("cursor-b")
    expect(cache.sessions.capabilities).toEqual(withoutDelete)
    expect(cache.error).toBeNull()
    expect(cache.loading).toBe(false)
  })

  it("keeps B loading when the old append fails first and retains the view's capability during the filter change", async () => {
    const cache = new SessionsCacheScope()
    const view = source(page(["a"], "a"))
    await cache.list(view, false, { cwd: "/a" })
    const old = Promise.withResolvers<SessionListPage>()
    const current = Promise.withResolvers<SessionListPage>()
    view.listSessions.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const append = cache.loadMore(view)
    const first = cache.list(view, false, { cwd: "/b" })
    old.reject(new Error("stale"))
    await append

    expect(cache.loading).toBe(true)
    expect(cache.supportsDelete(view)).toBe(true)
    expect(cache.error).toBeNull()
    expect(ids(cache)).toEqual([])
    current.resolve(page(["b"], "b", withoutDelete))
    await first
    expect(cache.loading).toBe(false)
    expect(ids(cache)).toEqual(["b"])
    expect(cache.sessions.nextCursor).toBe("b")
    expect(cache.supportsDelete(view)).toBe(false)
  })

  it("discards a first page after reset or source replacement", async () => {
    const cache = new SessionsCacheScope()
    const old = Promise.withResolvers<SessionListPage>()
    const firstView = source()
    firstView.listSessions.mockReturnValueOnce(old.promise)
    const first = cache.list(firstView)
    cache.reset()
    const secondView = source(page(["current"], "current", withoutDelete))
    await cache.list(secondView)
    old.resolve(page(["stale"], "stale"))
    await first

    expect(ids(cache)).toEqual(["current"])
    expect(cache.sessions.nextCursor).toBe("current")
    expect(cache.supportsDelete(firstView)).toBe(false)
    expect(cache.supportsDelete(secondView)).toBe(false)
    expect(cache.loading).toBe(false)
  })

  it("keeps deletion rejected across append, refresh and cwd changes until a new view", async () => {
    const cache = new SessionsCacheScope()
    const view = source(page(["a"], "cursor"))
    await cache.list(view)
    const next = Promise.withResolvers<SessionListPage>()
    view.listSessions.mockReturnValueOnce(next.promise)
    const append = cache.loadMore(view)
    cache.rejectDelete(view)
    expect(cache.supportsDelete(view)).toBe(false)
    next.resolve(page(["b"], "next"))
    await append
    expect(cache.supportsDelete(view)).toBe(false)
    await cache.list(view, true)
    await cache.list(view, false, { cwd: "/new" })
    expect(cache.supportsDelete(view)).toBe(false)

    const replacement = source(page(["replacement"]))
    await cache.list(replacement)
    expect(cache.supportsDelete(replacement)).toBe(true)
  })

  it("drops a successful old append after delete while retaining rows and the retriable cursor", async () => {
    const cache = new SessionsCacheScope()
    const view = source(page(["drop", "keep"], "cursor"))
    await cache.list(view)
    const pending = Promise.withResolvers<SessionListPage>()
    view.listSessions.mockReturnValueOnce(pending.promise)
    const append = cache.loadMore(view)
    cache.remove(view, "drop")
    pending.resolve(page(["drop", "late"]))
    await append

    expect(ids(cache)).toEqual(["keep"])
    expect(cache.sessions.nextCursor).toBe("cursor")
    expect(cache.loading).toBe(false)
  })

  it("restarts an invalidated first page at the same cwd after delete", async () => {
    const cache = new SessionsCacheScope()
    const view = source(page(["keep"], "fresh"))
    const pending = Promise.withResolvers<SessionListPage>()
    view.listSessions.mockReturnValueOnce(pending.promise)
    const first = cache.list(view, false, { cwd: "/fixture" })
    cache.remove(view, "drop")
    pending.resolve(page(["drop"], "old"))
    await first

    expect(view.listSessions.mock.calls).toEqual([[{ cwd: "/fixture" }], [{ cwd: "/fixture" }]])
    expect(ids(cache)).toEqual(["keep"])
    expect(cache.sessions.nextCursor).toBe("fresh")
  })

  it("keeps rows visible while appending and after append failure", async () => {
    const cache = new SessionsCacheScope()
    const view = source(page(["keep"], "cursor"))
    await cache.list(view)
    const pending = Promise.withResolvers<SessionListPage>()
    view.listSessions.mockReturnValueOnce(pending.promise)
    const append = cache.loadMore(view)
    expect(ids(cache)).toEqual(["keep"])
    expect(cache.loading).toBe(true)
    pending.reject(new Error("append failed"))
    await append
    expect(ids(cache)).toEqual(["keep"])
    expect(cache.error).toBe("append failed")
    expect(cache.sessions.nextCursor).toBe("cursor")
  })
})
