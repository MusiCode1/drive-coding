/**
 * settings-be-url-scope-policy.test.ts — setBeUrl → scope policy refresh (C3).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { DEFAULTS } from "./settings-persistence.js"

vi.mock("../adapters/scope-policy-api.js", () => ({
  fetchScopePolicy: vi.fn(),
  patchScopePolicy: vi.fn(),
}))

vi.mock("./settings-persistence.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./settings-persistence.js")>()
  return {
    ...orig,
    loadSettings: () => ({ ...DEFAULTS, beUrl: "http://localhost:4000" }),
    saveSettings: vi.fn(),
  }
})

import { fetchScopePolicy } from "../adapters/scope-policy-api.js"
import { Settings } from "./settings.svelte.js"

const mockFetch = fetchScopePolicy as ReturnType<typeof vi.fn>

const snap = {
  policies: { message: "ask", update: "ask", close: "ask" },
  sources: { message: "default", update: "default", close: "default" },
} as const

beforeEach(() => {
  vi.resetAllMocks()
  mockFetch.mockResolvedValue(snap)
})

describe("Settings.setBeUrl scope policy bridge", () => {
  it("refetches policy when BE URL changes", async () => {
    const settings = new Settings()
    await settings.scopePolicy.refresh()
    mockFetch.mockClear()

    const res = settings.setBeUrl("http://localhost:4001")
    expect(res.ok).toBe(true)
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(settings.scopePolicy.confirmed).toEqual(snap))
  })

  it("does not refetch when URL unchanged", async () => {
    const settings = new Settings()
    await settings.scopePolicy.refresh()
    mockFetch.mockClear()

    settings.setBeUrl("http://localhost:4000")
    await new Promise((r) => setTimeout(r, 20))
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
