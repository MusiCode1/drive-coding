/**
 * settings.input-mode.test.svelte.ts — persist inputMode (record footer tab).
 *
 * ─── slice ui-shell-session-prefs ───
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { Settings } from "./settings.svelte"

const STORAGE_KEY = "drive-coding-v2-settings"

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
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

describe("Settings — inputMode (ui-shell-session-prefs)", () => {
  test("default record when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.inputMode).toBe("record")
  })

  test("setInputMode typing persists to drive-coding-v2-settings", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setInputMode("typing")
    expect(s.inputMode).toBe("typing")
    const raw = store.get(STORAGE_KEY)
    expect(JSON.parse(raw as string).inputMode).toBe("typing")
  })

  test("new Settings reads inputMode from existing blob", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ inputMode: "live" }))
    const s = new Settings()
    expect(s.inputMode).toBe("live")
  })

  test("invalid inputMode in blob coerces to record", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ inputMode: "nope" }))
    const s = new Settings()
    expect(s.inputMode).toBe("record")
  })

  test("persisted blob has no sheetDetent key", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setInputMode("hidden")
    const raw = store.get(STORAGE_KEY)
    const parsed = JSON.parse(raw as string)
    expect(parsed).not.toHaveProperty("sheetDetent")
  })
})
