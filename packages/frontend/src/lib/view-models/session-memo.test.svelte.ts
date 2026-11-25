// @vitest-environment jsdom
/**
 * session-memo.test.svelte.ts — per-session persistence for SessionMemoVM.
 * (slice session-memo-pad · session-memory C2)
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import Harness from "./session-memo.harness.svelte"
import { memoStorageKey, parseMemo, type SessionMemoVM } from "./session-memo.svelte"

vi.mock("$lib/adapters/agents-api", () => ({
  patchAgent: vi.fn(async () => {}),
}))

import { patchAgent } from "$lib/adapters/agents-api"

const patchAgentMock = vi.mocked(patchAgent)

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  })
  return store
}

type HarnessExports = {
  memo: SessionMemoVM
  source: { agentId: string | null; sessionId: string | null; agentNotes?: string }
}

let target: HTMLDivElement | null = null
let app: HarnessExports | null = null

function mountHarness(reactive = false): HarnessExports {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(Harness, { target, props: { reactive } }) as HarnessExports
  return app
}

beforeEach(() => {
  vi.unstubAllGlobals()
  patchAgentMock.mockReset().mockResolvedValue(undefined)
  vi.useFakeTimers()
})

afterEach(() => {
  if (app !== null) unmount(app as Record<string, unknown>)
  target?.remove()
  target = null
  app = null
  vi.useRealTimers()
})

describe("memoStorageKey", () => {
  test("keys are namespaced per session", () => {
    expect(memoStorageKey("abc")).toBe("dc:session-memo:abc")
    expect(memoStorageKey("abc")).not.toBe(memoStorageKey("def"))
  })

  test("no session yields no key — nothing is loaded or stored", () => {
    expect(memoStorageKey(null)).toBeNull()
    expect(memoStorageKey("")).toBeNull()
  })
})

describe("parseMemo", () => {
  test("missing or corrupt storage yields a minimized memo", () => {
    const empty = { minimized: true }
    expect(parseMemo(null)).toEqual(empty)
    expect(parseMemo('{"text":"half')).toEqual(empty)
    expect(parseMemo("not json")).toEqual(empty)
  })

  test("only an explicit false counts as expanded", () => {
    expect(parseMemo('{"minimized":false}').minimized).toBe(false)
    expect(parseMemo('{"minimized":true}').minimized).toBe(true)
    expect(parseMemo("{}").minimized).toBe(true)
  })

  test("legacy blobs with text ignore the text field", () => {
    expect(parseMemo('{"text":"session topic","minimized":false}')).toEqual({
      minimized: false,
    })
  })
})

describe("SessionMemoVM", () => {
  function show(
    source: HarnessExports["source"],
    agentId: string | null,
    sessionId: string | null,
    notes?: string,
  ) {
    Object.assign(source, { agentId, sessionId, agentNotes: notes })
    flushSync()
  }

  function deferred() {
    let resolve!: () => void
    let reject!: (reason: Error) => void
    const promise = new Promise<void>((ok, fail) => {
      resolve = ok
      reject = fail
    })
    return { promise, resolve, reject }
  }

  test("late same-agent hydrate, minimize, move and resize never PATCH", async () => {
    const store = installLocalStorage()
    const { memo, source } = mountHarness(true)
    show(source, "a", null)
    await vi.advanceTimersByTimeAsync(400)
    expect(patchAgentMock).not.toHaveBeenCalled()
    source.sessionId = "s1"
    flushSync()
    source.agentNotes = "hydrated"
    flushSync()
    expect(memo.text).toBe("hydrated")
    expect(store.size).toBe(0)

    memo.setMinimized(false)
    expect(store.get("dc:session-memo:s1")).toBe('{"minimized":false}')
    memo.setPos({ left: 12, top: 34 })
    memo.setSize({ width: 280, height: 160 })
    expect(store.get("dc:session-memo-pos")).toBe('{"left":12,"top":34}')
    expect(store.get("dc:session-memo-size")).toBe('{"width":280,"height":160}')
    memo.toggle()
    expect(store.has("dc:session-memo:s1")).toBe(false)
    source.agentNotes = "refreshed"
    flushSync()
    expect(memo.text).toBe("refreshed")
    await vi.advanceTimersByTimeAsync(400)
    expect(patchAgentMock).not.toHaveBeenCalled()
  })

  test("debounce uses the newest real edit; explicit clearing is a write", async () => {
    installLocalStorage()
    const { memo, source } = mountHarness(true)
    show(source, "a", "s1", "initial")
    memo.setText("initial")
    await vi.advanceTimersByTimeAsync(300)
    expect(patchAgentMock).not.toHaveBeenCalled()
    memo.setText("first")
    await vi.advanceTimersByTimeAsync(200)
    memo.setText("latest")
    await vi.advanceTimersByTimeAsync(299)
    expect(patchAgentMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(patchAgentMock.mock.calls).toEqual([["a", { userNotes: "latest" }]])

    memo.setText("")
    await vi.advanceTimersByTimeAsync(300)
    source.agentNotes = ""
    flushSync()
    await vi.advanceTimersByTimeAsync(300)
    expect(memo.text).toBe("")
    expect(patchAgentMock.mock.calls).toEqual([
      ["a", { userNotes: "latest" }],
      ["a", { userNotes: "" }],
    ])
  })

  test.each(["success", "timeout"])(
    "ACP session changes preserve the local edit through %s",
    async (outcome) => {
      const store = installLocalStorage()
      store.set("dc:session-memo:s1", '{"minimized":false}')
      const { memo, source } = mountHarness(true)
      const write = deferred()
      patchAgentMock.mockReturnValueOnce(write.promise)
      show(source, "a", "s1", "old source")
      expect(memo.minimized).toBe(false)
      memo.setText("local edit")
      await vi.advanceTimersByTimeAsync(200)
      source.sessionId = "s2"
      flushSync()
      expect(memo.text).toBe("local edit")
      expect(memo.minimized).toBe(true)
      expect(patchAgentMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(99)
      expect(patchAgentMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(patchAgentMock.mock.calls).toEqual([["a", { userNotes: "local edit" }]])

      if (outcome === "success") write.resolve()
      else write.reject(new Error("PATCH timed out"))
      await vi.advanceTimersByTimeAsync(0)
      source.sessionId = "s1"
      flushSync()
      expect(memo.text).toBe("local edit")
      expect(memo.minimized).toBe(false)
      await vi.advanceTimersByTimeAsync(500)
      expect(patchAgentMock).toHaveBeenCalledTimes(1)
    },
  )

  test("switch, detach and teardown consume their pending edit just once", async () => {
    const store = installLocalStorage()
    const { memo, source } = mountHarness(true)
    show(source, "a", "same", "A")
    memo.setMinimized(false)
    memo.setText("edit A")
    source.agentId = "b"
    memo.setText("stale input")
    source.agentNotes = "B"
    flushSync()
    expect(memo.text).toBe("B")
    expect(memo.minimized).toBe(false)
    expect(store.get("dc:session-memo:same")).toBe('{"minimized":false}')
    expect(patchAgentMock.mock.calls).toEqual([["a", { userNotes: "edit A" }]])
    memo.setText("edit B")
    show(source, null, null)
    expect(memo.text).toBe("")
    expect(memo.minimized).toBe(true)

    memo.setText("mock draft")
    show(source, "c", "same", "C")
    expect(memo.text).toBe("C")
    expect(memo.minimized).toBe(false)
    memo.setText("edit C")
    if (!app) throw new Error("Missing memo harness")
    await unmount(app)
    app = null
    await vi.advanceTimersByTimeAsync(400)
    expect(patchAgentMock.mock.calls).toEqual([
      ["a", { userNotes: "edit A" }],
      ["b", { userNotes: "edit B" }],
      ["c", { userNotes: "edit C" }],
    ])
  })

  test.each(["success", "rejection"])(
    "writes are ordered by agent across an A/B/A switch and %s",
    async (outcome) => {
      installLocalStorage()
      const { memo, source } = mountHarness(true)
      const first = deferred()
      const latest = deferred()
      patchAgentMock.mockReturnValueOnce(first.promise)
      show(source, "a", "s1", "old A")
      memo.setText("first A")
      await vi.advanceTimersByTimeAsync(300)
      show(source, "b", "s2", "old B")
      memo.setText("new B")
      show(source, "a", "s1", "old A")
      expect(memo.text).toBe("first A")
      patchAgentMock.mockReturnValueOnce(latest.promise)
      memo.setText("latest A")
      await vi.advanceTimersByTimeAsync(300)
      source.agentNotes = "hydrate while A is queued"
      flushSync()
      expect(memo.text).toBe("latest A")
      expect(patchAgentMock.mock.calls).toEqual([
        ["a", { userNotes: "first A" }],
        ["b", { userNotes: "new B" }],
      ])
      if (outcome === "success") first.resolve()
      else first.reject(new Error("server error"))
      await vi.advanceTimersByTimeAsync(0)
      expect(patchAgentMock.mock.calls[2]).toEqual(["a", { userNotes: "latest A" }])

      show(source, "b", "s2", "fresh B")
      latest.resolve()
      await vi.advanceTimersByTimeAsync(400)
      expect(memo.text).toBe("fresh B")
      expect(patchAgentMock).toHaveBeenCalledTimes(3)
    },
  )

  test("manual harness preserves storage and local mock behavior", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()
    memo.setText("unattached")
    expect(store.size).toBe(0)
    memo.setSessionId("s1", "a1", "")
    expect(memo.text).toBe("")
    expect(memo.minimized).toBe(true)
    memo.toggle()
    memo.setSessionId("s2", "a2", "")
    expect(memo.minimized).toBe(true)
    expect(store.has("dc:session-memo:s2")).toBe(false)
    memo.setSessionId("s1", "a1", "   \n  ")
    expect(memo.minimized).toBe(false)
    expect(memo.hasContent).toBe(false)
    memo.setSessionId("s1", "a1", "has content")
    expect(memo.hasContent).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(patchAgentMock).not.toHaveBeenCalled()
  })
})
