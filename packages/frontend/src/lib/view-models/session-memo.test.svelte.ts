// @vitest-environment jsdom
/**
 * session-memo.test.svelte.ts — per-session persistence for SessionMemoVM.
 * (slice session-memo-pad)
 *
 * הדגש כאן הוא על מה שנכשל בשקט: מפתח-לכל-סשן. באג של מפתח יחיד נראה תקין
 * כל עוד פותחים סשן אחד, ומדליף את הממו של סשן א' לסשן ב' רק אחרי מעבר —
 * בדיוק המצב שהפיצ'ר נועד לשרת (עשרה סשנים במקביל).
 */
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import Harness from "./session-memo.harness.svelte"
import { memoStorageKey, parseMemo, type SessionMemoVM } from "./session-memo.svelte"

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

// ה-exports של ה-harness מוצהרים במפורש ולא נגזרים דרך
// `ReturnType<typeof mount<typeof Harness>>` — הצורה הזו (כפי שהיא ב-
// composer-draft.test) לא עוברת svelte-check, ומוסיפה 4 שגיאות typecheck.
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
  test("missing or corrupt storage yields an empty, minimized memo", () => {
    const empty = { text: "", minimized: true }
    expect(parseMemo(null)).toEqual(empty)
    expect(parseMemo('{"text":"half')).toEqual(empty)
    expect(parseMemo("not json")).toEqual(empty)
  })

  test("only an explicit false counts as expanded", () => {
    expect(parseMemo('{"minimized":false}').minimized).toBe(false)
    expect(parseMemo('{"minimized":true}').minimized).toBe(true)
    expect(parseMemo("{}").minimized).toBe(true)
  })

  test("text survives a round trip", () => {
    expect(parseMemo('{"text":"session topic","minimized":false}')).toEqual({
      text: "session topic",
      minimized: false,
    })
  })
})

describe("SessionMemoVM", () => {
  test("text persists under the active session's key after debounce", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    memo.text = "check the sync"
    await waitForPersist()

    expect(JSON.parse(store.get("dc:session-memo:s1") as string)).toEqual({
      text: "check the sync",
      minimized: true,
    })
  })

  test("each session keeps its own memo, and switching back restores it", async () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    memo.text = "memo for one"
    await waitForPersist()

    memo.setSessionId("s2")
    expect(memo.text).toBe("")

    memo.text = "memo for two"
    await waitForPersist()

    memo.setSessionId("s1")
    expect(memo.text).toBe("memo for one")

    memo.setSessionId("s2")
    expect(memo.text).toBe("memo for two")
  })

  test("switching sessions inside the debounce window does not lose the text", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    memo.text = "typed then switched immediately"
    // בלי המתנה ל-debounce — setSessionId חייב לשטוף בעצמו.
    memo.setSessionId("s2")

    expect(JSON.parse(store.get("dc:session-memo:s1") as string).text).toBe(
      "typed then switched immediately",
    )
  })

  test("text typed for one session never lands under another session's key", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    memo.text = "belongs to s1"
    memo.setSessionId("s2")
    await waitForPersist()

    expect(store.get("dc:session-memo:s2")).toBeUndefined()
    expect(JSON.parse(store.get("dc:session-memo:s1") as string).text).toBe("belongs to s1")
  })

  test("minimize state persists immediately, without waiting for the debounce", () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    memo.text = "some notes"
    memo.setMinimized(false)

    expect(JSON.parse(store.get("dc:session-memo:s1") as string).minimized).toBe(false)
  })

  test("an expanded memo reopens expanded", async () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    memo.setMinimized(false)
    memo.text = "still open"
    await waitForPersist()

    memo.setSessionId("s2")
    memo.setSessionId("s1")

    expect(memo.minimized).toBe(false)
    expect(memo.text).toBe("still open")
  })

  test("an empty, minimized memo leaves no stored record", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    memo.text = "typed then cleared"
    await waitForPersist()
    expect(store.get("dc:session-memo:s1")).toBeDefined()

    memo.text = ""
    await waitForPersist()
    expect(store.get("dc:session-memo:s1")).toBeUndefined()
  })

  test("with no session nothing is written at all", async () => {
    const store = installLocalStorage()
    const { memo } = mountHarness()

    memo.text = "no session yet"
    await waitForPersist()

    expect(store.size).toBe(0)
  })

  test("hasContent ignores whitespace-only text", () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    expect(memo.hasContent).toBe(false)
    memo.text = "   \n  "
    expect(memo.hasContent).toBe(false)
    memo.text = "x"
    expect(memo.hasContent).toBe(true)
  })

  test("toggle flips minimized both ways — there is no close path", () => {
    installLocalStorage()
    const { memo } = mountHarness()

    memo.setSessionId("s1")
    expect(memo.minimized).toBe(true)
    memo.toggle()
    expect(memo.minimized).toBe(false)
    memo.toggle()
    expect(memo.minimized).toBe(true)
  })
})
