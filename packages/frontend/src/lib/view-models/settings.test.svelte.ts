/**
 * settings.test.svelte.ts — unit tests for the Settings view-model.
 *
 * Why `.svelte.ts` extension on a test file:
 *   Vite-plugin-svelte's preprocessor only runs on `*.svelte`, `*.svelte.ts`,
 *   `*.svelte.js`. We don't actually need runes in the test itself, but
 *   colocating the extension with the SUT (settings.svelte.ts) avoids
 *   surprises if a future test ever uses `$state` directly. It also makes
 *   the include glob in vitest.config.ts simpler.
 *
 * Coverage (mapped to docs/plans/testing-coverage.md §4 Commit 5 tests 1–7):
 *   1. Default voiceId = Sarah when localStorage empty.
 *   2. setVoiceId writes to localStorage.
 *   3. New Settings() reads the persisted voiceId.
 *   4. loadVoices populates availableVoices + drives loading/error state.
 *   5. Idempotency: 2 sequential loadVoices → adapter called once.
 *   6. Retry on error: failed → 2nd call refetches.
 *   7. Concurrency: 2 unawaited loadVoices → adapter called once (loading guard).
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

// Mock the voices adapter BEFORE importing Settings. `vi.mock` is hoisted.
vi.mock("../adapters/voice/voices", () => ({
  listVoices: vi.fn(),
}))

import { Settings } from "./settings.svelte"
import { listVoices } from "../adapters/voice/voices"

const SARAH_ID = "EXAVITQu4vr4xnSDxMaL"
const STORAGE_KEY = "drive-coding-v2-settings"

const voicesFixture = [
  { voice_id: "v1", name: "Test Voice 1" },
  { voice_id: "v2", name: "Test Voice 2" },
]

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
  vi.mocked(listVoices).mockReset()
})

describe("Settings — persisted voice", () => {
  test("default voiceId = Sarah when localStorage empty", () => {
    installLocalStorage()
    const s = new Settings()
    expect(s.voiceId).toBe(SARAH_ID)
  })

  test("setVoiceId writes to localStorage", () => {
    const store = installLocalStorage()
    const s = new Settings()
    s.setVoiceId("v2")
    expect(s.voiceId).toBe("v2")
    const raw = store.get(STORAGE_KEY)
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw as string)
    expect(parsed.voiceId).toBe("v2")
  })

  test("new Settings() reads the persisted voiceId from localStorage", () => {
    const store = installLocalStorage()
    store.set(STORAGE_KEY, JSON.stringify({ cliKind: "opencode", lastCwd: "", voiceId: "v2" }))
    const s = new Settings()
    expect(s.voiceId).toBe("v2")
  })
})

describe("Settings — loadVoices", () => {
  test("populates availableVoices and drives loading/error", async () => {
    installLocalStorage()
    vi.mocked(listVoices).mockResolvedValueOnce(voicesFixture)
    const s = new Settings()

    expect(s.availableVoices).toEqual([])
    expect(s.voicesLoading).toBe(false)
    expect(s.voicesError).toBeNull()

    const inflight = s.loadVoices()
    // Synchronously after call: loading flag is set BEFORE the await.
    expect(s.voicesLoading).toBe(true)

    await inflight

    expect(s.voicesLoading).toBe(false)
    expect(s.voicesError).toBeNull()
    expect(s.availableVoices).toEqual(voicesFixture)
  })

  test("idempotent: 2 sequential calls → adapter invoked once", async () => {
    installLocalStorage()
    vi.mocked(listVoices).mockResolvedValue(voicesFixture)
    const s = new Settings()

    await s.loadVoices()
    await s.loadVoices()

    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)
    expect(s.availableVoices).toEqual(voicesFixture)
  })

  test("retry on error: failed first call → second call refetches", async () => {
    installLocalStorage()
    vi.mocked(listVoices)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(voicesFixture)
    const s = new Settings()

    await s.loadVoices()
    expect(s.voicesError).toBe("network down")
    expect(s.availableVoices).toEqual([])
    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)

    await s.loadVoices()
    expect(s.voicesError).toBeNull()
    expect(s.availableVoices).toEqual(voicesFixture)
    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(2)
  })

  test("concurrent: 2 unawaited calls → adapter invoked once (loading guard)", async () => {
    installLocalStorage()
    // Hold the first call open so the 2nd one can hit the loading guard.
    let resolveFirst!: (v: typeof voicesFixture) => void
    vi.mocked(listVoices).mockImplementationOnce(
      () => new Promise<typeof voicesFixture>((r) => (resolveFirst = r)),
    )
    const s = new Settings()

    const p1 = s.loadVoices()
    const p2 = s.loadVoices() // should bail on `voicesLoading === true`
    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)

    resolveFirst(voicesFixture)
    await Promise.all([p1, p2])

    expect(vi.mocked(listVoices)).toHaveBeenCalledTimes(1)
    expect(s.availableVoices).toEqual(voicesFixture)
  })
})
