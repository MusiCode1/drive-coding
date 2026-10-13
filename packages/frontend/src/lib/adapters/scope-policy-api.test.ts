/**
 * scope-policy-api.test.ts — adapter validation (C3).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("$lib/util/be-url", () => ({
  beUrl: (path: string) => `http://localhost:4000${path}`,
}))

import { fetchScopePolicy, patchScopePolicy } from "./scope-policy-api"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("scope-policy-api", () => {
  it("fetchScopePolicy rejects malformed snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ policies: { message: "nope" } }),
      }),
    )
    await expect(fetchScopePolicy()).rejects.toThrow(/invalid response/)
  })

  it("patchScopePolicy round-trips valid body", async () => {
    const snap = {
      policies: { message: "allow", update: "ask", close: "ask" },
      sources: { message: "override", update: "default", close: "default" },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => snap,
      }),
    )
    const out = await patchScopePolicy({ policies: { message: "allow" } })
    expect(out).toEqual(snap)
  })
})
