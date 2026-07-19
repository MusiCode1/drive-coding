/**
 * settings.project-system-prompt.test.svelte.ts — טסטים עבור projectSystemPrompt
 * (slice project-system-prompt, Commit 2 — DoD #5: אחסון פר-cwd נשמר).
 *
 * כיסוי:
 *   1. projectSystemPrompt ברירת-מחדל: {} כש-localStorage ריק.
 *   2. getProjectPrompt מחזיר "" כש-אין ערך שמור ל-cwd.
 *   3. setProjectPrompt שומר ב-localStorage + נגיש דרך getProjectPrompt.
 *   4. round-trip: Settings חדש קורא projectSystemPrompt מ-localStorage.
 *   5. setProjectPrompt מרובה cwd — keying נפרד, לא דורס.
 *   6. תאימות-לאחור: localStorage ישן בלי projectSystemPrompt → ברירת-מחדל {}.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

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

describe("Settings — projectSystemPrompt (slice project-system-prompt)", () => {
  test("projectSystemPrompt ברירת-מחדל = {} כש-localStorage ריק", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.projectSystemPrompt).toEqual({})
  })

  test("getProjectPrompt מחזיר '' כש-אין ערך שמור ל-cwd", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.getProjectPrompt("/proj")).toBe("")
  })

  test("setProjectPrompt(cwd,'x') → getProjectPrompt(cwd)==='x' + נשמר ב-localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setProjectPrompt("/proj", "Always answer in Hebrew")
    expect(s.getProjectPrompt("/proj")).toBe("Always answer in Hebrew")
    const parsed = JSON.parse(store.get(STORAGE_KEY) as string)
    expect(parsed.projectSystemPrompt).toEqual({ "/proj": "Always answer in Hebrew" })
  })

  test("round-trip: Settings חדש (reload) קורא projectSystemPrompt מ-localStorage", () => {
    installLocalStorage()
    const s1 = new Settings()
    s1.setProjectPrompt("/proj", "persisted text")
    // instance חדש — טוען מה-localStorage (מדמה reload)
    const s2 = new Settings()
    expect(s2.getProjectPrompt("/proj")).toBe("persisted text")
  })

  test("setProjectPrompt מרובה cwd — keying נפרד, לא דורס", () => {
    installLocalStorage()
    const s = new Settings()
    s.setProjectPrompt("/proj-a", "prompt A")
    s.setProjectPrompt("/proj-b", "prompt B")
    expect(s.getProjectPrompt("/proj-a")).toBe("prompt A")
    expect(s.getProjectPrompt("/proj-b")).toBe("prompt B")
  })

  test("setProjectPrompt דורס ערך קודם לאותו cwd", () => {
    installLocalStorage()
    const s = new Settings()
    s.setProjectPrompt("/proj", "first")
    s.setProjectPrompt("/proj", "second")
    expect(s.getProjectPrompt("/proj")).toBe("second")
  })

  test("תאימות-לאחור: localStorage ישן בלי projectSystemPrompt → ברירת-מחדל {}", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", voiceId: "v1" }))
    const s = new Settings()
    expect(s.projectSystemPrompt).toEqual({})
    expect(s.getProjectPrompt("/anything")).toBe("")
  })
})
