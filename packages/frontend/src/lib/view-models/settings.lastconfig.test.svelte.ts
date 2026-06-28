/**
 * settings.lastconfig.test.svelte.ts — TDD טסטים עבור lastConfig (slice-restore-last-config).
 *
 * כיסוי:
 *   1. lastConfig ברירת-מחדל: {} כש-localStorage ריק.
 *   2. setLastConfig ממזג + שומר ב-localStorage.
 *   3. round-trip: Settings חדש קורא את lastConfig מה-localStorage.
 *   4. setLastConfig מרובה מפתחות (merge, לא החלפה).
 *   5. תאימות-לאחור: localStorage ישן בלי lastConfig → ברירת-מחדל {}.
 *   6. setLastConfig עם cliKind שונה — keying per-cliKind.
 */

import { beforeEach, describe, expect, test } from "vitest"
import { vi } from "vitest"

// צור Mock לאדפטר של ה-voices לפני ייבוא Settings.
vi.mock("../adapters/voice/voices", () => ({
  listVoices: vi.fn(),
}))

import { Settings } from "./settings.svelte"

const STORAGE_KEY = "drive-coding-v2-settings"

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  })
  return store
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("Settings — lastConfig (slice-restore-last-config)", () => {
  test("lastConfig ברירת-מחדל = {} כש-localStorage ריק", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.lastConfig).toEqual({})
  })

  test("setLastConfig ממזג ושומר ב-localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setLastConfig("opencode", "mode", "ask")
    expect(s.lastConfig).toEqual({ opencode: { mode: "ask" } })
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.lastConfig).toEqual({ opencode: { mode: "ask" } })
  })

  test("round-trip: Settings חדש קורא lastConfig מ-localStorage", () => {
    const store = installLocalStorage()
    const s1 = new Settings()
    s1.setLastConfig("opencode", "mode", "auto")
    // instance חדש — טוען מה-localStorage
    const s2 = new Settings()
    expect(s2.lastConfig).toEqual({ opencode: { mode: "auto" } })
  })

  test("setLastConfig מרובה — merge, לא החלפה", () => {
    installLocalStorage()
    const s = new Settings()
    s.setLastConfig("opencode", "mode", "ask")
    s.setLastConfig("opencode", "model", "gpt-4")
    expect(s.lastConfig["opencode"]).toEqual({ mode: "ask", model: "gpt-4" })
  })

  test("תאימות-לאחור: localStorage ישן בלי lastConfig → ברירת-מחדל {}", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", voiceId: "v1" }))
    const s = new Settings()
    expect(s.lastConfig).toEqual({})
  })

  test("per-cliKind: כל cli מקבל keying נפרד", () => {
    installLocalStorage()
    const s = new Settings()
    s.setLastConfig("opencode", "mode", "ask")
    s.setLastConfig("claude", "mode", "auto")
    expect(s.lastConfig["opencode"]).toEqual({ mode: "ask" })
    expect(s.lastConfig["claude"]).toEqual({ mode: "auto" })
  })

  test("setLastConfig עם value boolean נשמר נכון", () => {
    installLocalStorage()
    const s = new Settings()
    s.setLastConfig("opencode", "someToggle", true)
    expect(s.lastConfig["opencode"]).toEqual({ someToggle: true })
  })

  test("setLastConfig idempotent: דריסה עם אותו ערך", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setLastConfig("opencode", "mode", "ask")
    s.setLastConfig("opencode", "mode", "ask")
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.lastConfig).toEqual({ opencode: { mode: "ask" } })
  })
})
