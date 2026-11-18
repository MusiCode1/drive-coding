/**
 * settings.sidebar-width.test.svelte.ts — persist + clamp for sidebar width.
 *
 * ─── slice sidebar-resize ───
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { DEFAULT_SIDEBAR_WIDTH_REM } from "../util/sidebar-width"
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

describe("Settings — sidebarWidthRem (sidebar-resize)", () => {
  test("default 18rem when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.sidebarWidthRem).toBe(DEFAULT_SIDEBAR_WIDTH_REM)
  })

  test("corrupt localStorage value falls back to default", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ sidebarWidthRem: "abc" }))
    const s = new Settings()
    expect(s.sidebarWidthRem).toBe(DEFAULT_SIDEBAR_WIDTH_REM)
    expect(Number.isFinite(s.sidebarWidthRem)).toBe(true)
  })

  test("out-of-range stored value is clamped on load", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ sidebarWidthRem: 40 }))
    const s = new Settings()
    expect(s.sidebarWidthRem).toBe(32)
  })

  test("setSidebarWidthRem clamps and persists", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setSidebarWidthRem(13)
    expect(s.sidebarWidthRem).toBe(14)
    const raw = store.get(STORAGE_KEY)
    expect(JSON.parse(raw as string).sidebarWidthRem).toBe(14)
  })
})
