// @vitest-environment jsdom
/**
 * composer-draft.test.svelte.ts — localStorage persistence for ComposerDraft.
 * (slice voice-pending-persistence, Commit 1)
 */
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import Harness from "./composer-draft.harness.svelte"

const STORAGE_KEY = "dc:composer-draft"

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

let target: HTMLDivElement | null = null
let app: ReturnType<typeof mount<typeof Harness>> | null = null

function mountHarness(): ReturnType<typeof mount<typeof Harness>> {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(Harness, { target })
  return app
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
  vi.useRealTimers()
})

describe("ComposerDraft persistence", () => {
  test("typing into draft.text persists after debounce", async () => {
    const store = installLocalStorage()
    const harness = mountHarness()

    harness.draft.text = "hello draft"
    await waitForPersist()

    const raw = store.get(STORAGE_KEY)
    expect(raw).toBeDefined()
    expect(JSON.parse(raw as string)).toEqual({ text: "hello draft" })
  })

  test("direct draft.text mutation persists (bind:value path)", async () => {
    const store = installLocalStorage()
    const harness = mountHarness()

    harness.draft.text = "via bind"
    await waitForPersist()

    expect(JSON.parse(store.get(STORAGE_KEY) as string).text).toBe("via bind")
  })

  test("corrupt JSON in localStorage yields empty text", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, "{not json")

    const harness = mountHarness()
    expect(harness.draft.text).toBe("")
  })

  test("clear removes storage key", async () => {
    const store = installLocalStorage()
    const harness = mountHarness()

    harness.draft.text = "temporary"
    await waitForPersist()
    expect(store.has(STORAGE_KEY)).toBe(true)

    harness.draft.clear()
    expect(harness.draft.text).toBe("")
    expect(store.has(STORAGE_KEY)).toBe(false)
  })

  test("appendDictation triggers persist via text mutation", async () => {
    const store = installLocalStorage()
    const harness = mountHarness()

    harness.draft.appendDictation("spoken words")
    await waitForPersist()

    expect(JSON.parse(store.get(STORAGE_KEY) as string).text).toBe("spoken words")
  })

  test("loads persisted text on construction", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ text: "restored" }))

    const harness = mountHarness()
    expect(harness.draft.text).toBe("restored")
  })
})
