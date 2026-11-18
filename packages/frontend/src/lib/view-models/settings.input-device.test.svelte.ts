/**
 * settings.input-device.test.svelte.ts — persist inputDeviceId (slice mic-device-selection).
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

describe("Settings — inputDevice (mic-device-selection)", () => {
  test("default null and empty label when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.inputDeviceId).toBe(null)
    expect(s.inputDeviceLabel).toBe("")
  })

  test("setInputDevice persists to drive-coding-v2-settings", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setInputDevice("abc", "Phone mic")
    expect(s.inputDeviceId).toBe("abc")
    expect(s.inputDeviceLabel).toBe("Phone mic")
    const raw = store.get(STORAGE_KEY)
    const parsed = JSON.parse(raw as string)
    expect(parsed.inputDeviceId).toBe("abc")
    expect(parsed.inputDeviceLabel).toBe("Phone mic")
  })

  test("new Settings reads inputDeviceId from existing blob", () => {
    const store = installLocalStorage()
    store.set(
      STORAGE_KEY,
      JSON.stringify({ inputDeviceId: "dev-1", inputDeviceLabel: "Built-in" }),
    )
    const s = new Settings()
    expect(s.inputDeviceId).toBe("dev-1")
    expect(s.inputDeviceLabel).toBe("Built-in")
  })

  test("legacy blob without keys yields null without throw", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ voiceId: "x" }))
    expect(() => new Settings()).not.toThrow()
    const s = new Settings()
    expect(s.inputDeviceId).toBe(null)
    expect(s.inputDeviceLabel).toBe("")
  })
})
