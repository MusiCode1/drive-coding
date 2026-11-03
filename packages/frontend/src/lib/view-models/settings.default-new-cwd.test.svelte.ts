/**
 * settings.default-new-cwd.test.svelte.ts — persistence of the `/new` fallback folder.
 *
 * Covers the two things that would break silently: a settings blob written before this
 * field existed must still load (back-compat), and the value must survive a reload —
 * otherwise the link would work once and dead-end after a refresh.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("../adapters/voice/voices", () => ({
  listVoices: vi.fn(),
}))

import { Settings } from "./settings.svelte"

const STORAGE_KEY = "drive-coding-v2-settings"

function installLocalStorage(seed?: string): Map<string, string> {
  const store = new Map<string, string>()
  if (seed !== undefined) store.set(STORAGE_KEY, seed)
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

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("Settings — defaultNewCwd", () => {
  test("defaults to empty, which means 'show the folder picker'", () => {
    installLocalStorage()
    expect(new Settings().defaultNewCwd).toBe("")
  })

  test("setDefaultNewCwd persists the value", () => {
    const store = installLocalStorage()
    const s = new Settings()

    s.setDefaultNewCwd("/home/u/Projects/app")

    expect(s.defaultNewCwd).toBe("/home/u/Projects/app")
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.defaultNewCwd).toBe("/home/u/Projects/app")
  })

  test("trims on the way in, so a stray space cannot make the path unusable", () => {
    installLocalStorage()
    const s = new Settings()

    s.setDefaultNewCwd("  /home/u/app  ")

    expect(s.defaultNewCwd).toBe("/home/u/app")
  })

  test("round-trips through a fresh Settings — the link must survive a refresh", () => {
    installLocalStorage()
    const first = new Settings()
    first.setDefaultNewCwd("/home/u/app")

    expect(new Settings().defaultNewCwd).toBe("/home/u/app")
  })

  test("a settings blob written before this field existed still loads", () => {
    installLocalStorage(JSON.stringify({ cliKind: "claude", lastCwd: "/tmp" }))

    const s = new Settings()

    expect(s.defaultNewCwd).toBe("")
    expect(s.cliKind).toBe("claude")
  })

  test("clearing it goes back to the picker", () => {
    installLocalStorage()
    const s = new Settings()
    s.setDefaultNewCwd("/home/u/app")

    s.setDefaultNewCwd("")

    expect(s.defaultNewCwd).toBe("")
  })
})
