// @vitest-environment jsdom
/**
 * session-memo.test.svelte.ts — per-session persistence for SessionMemoVM.
 * (slice session-memo-pad · session-memory C2)
 */
import { mount, tick, unmount } from "svelte"
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

async function waitForPersist(): Promise<void> {
  await tick()
  await new Promise((resolve) => setTimeout(resolve, 320))
}

type HarnessExports = { memo: SessionMemoVM }

let target: HTMLDivElement | null = null
let app: HarnessExports | null = null

function mountHarness(): HarnessExports {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(Harness, { target }) as HarnessExports
  return app
}

beforeEach(() => {
  vi.unstubAllGlobals()
  patchAgentMock.mockClear()
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
  test("minimized persists under the active session key after debounce", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-1", "")
    memo.setMinimized(false)
    await waitForPersist()

    expect(JSON.parse(store.get("dc:session-memo:s1") as string)).toEqual({
      minimized: false,
    })
    expect(store.get("dc:session-memo:s1")).not.toContain("text")
  })

  test("debounce PATCHes userNotes when agentId is set", async () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-1", "")
    memo.text = "sync to BE"
    await waitForPersist()

    expect(patchAgentMock).toHaveBeenCalledWith("agent-1", { userNotes: "sync to BE" })
  })

  test("each session keeps its own note text via userNotes hydration", async () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "a1", "memo for one")
    memo.setSessionId("s2", "a2", "")
    expect(memo.text).toBe("")

    memo.text = "memo for two"
    memo.setSessionId("s1", "a1", "memo for one")
    expect(memo.text).toBe("memo for one")

    memo.setSessionId("s2", "a2", "memo for two")
    expect(memo.text).toBe("memo for two")
  })

  test("switching sessions inside the debounce window flushes text to the previous agent", async () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-a", "")
    memo.text = "typed then switched immediately"
    memo.setSessionId("s2", "agent-b", "")

    expect(patchAgentMock).toHaveBeenCalledWith("agent-a", {
      userNotes: "typed then switched immediately",
    })
  })

  test("agent transition flush targets the previous agentId, not the new one", async () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-a", "")
    memo.text = "belongs to A"
    memo.setSessionId("s2", "agent-b", "")
    await waitForPersist()

    expect(patchAgentMock).toHaveBeenCalledWith("agent-a", { userNotes: "belongs to A" })
    expect(patchAgentMock).not.toHaveBeenCalledWith("agent-b", { userNotes: "belongs to A" })
  })

  test("minimize state persists immediately, without waiting for the debounce", () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-1", "")
    memo.setMinimized(false)

    expect(JSON.parse(store.get("dc:session-memo:s1") as string).minimized).toBe(false)
  })

  test("an expanded memo reopens expanded", async () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-1", "")
    memo.setMinimized(false)
    await waitForPersist()

    memo.setSessionId("s2", "agent-2", "")
    memo.setSessionId("s1", "agent-1", "still open")

    expect(memo.minimized).toBe(false)
    expect(memo.text).toBe("still open")
  })

  test("a minimized memo with no expansion leaves no stored record", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-1", "")
    await waitForPersist()
    expect(store.get("dc:session-memo:s1")).toBeUndefined()
  })

  test("with no session nothing is written to localStorage", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.text = "no session yet"
    await waitForPersist()

    expect(store.size).toBe(0)
    expect(patchAgentMock).not.toHaveBeenCalled()
  })

  test("hasContent ignores whitespace-only text", () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-1", "")
    expect(memo.hasContent).toBe(false)
    memo.text = "   \n  "
    expect(memo.hasContent).toBe(false)
    memo.text = "x"
    expect(memo.hasContent).toBe(true)
  })

  test("toggle flips minimized both ways — there is no close path", () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1", "agent-1", "")
    expect(memo.minimized).toBe(true)
    memo.toggle()
    expect(memo.minimized).toBe(false)
    memo.toggle()
    expect(memo.minimized).toBe(true)
  })
})
