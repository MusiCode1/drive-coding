/**
 * scope-policy-api.test.ts — adapter validation (C3).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("$lib/util/be-url", () => ({
  beUrl: (path: string) => `http://localhost:4000${path}`,
}))

import {
  fetchScopePolicy,
  fetchScopePolicyForAgent,
  patchScopePolicy,
  patchScopePolicyForAgent,
} from "./scope-policy-api"

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

  it("fetchScopePolicyForAgent uses agent query", async () => {
    const snap = {
      policies: { message: "allow", update: "ask", close: "ask" },
      sources: { message: "agent", update: "default", close: "default" },
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snap })
    vi.stubGlobal("fetch", fetchMock)
    const out = await fetchScopePolicyForAgent("550e8400-e29b-41d4-a716-446655440000")
    expect(out).toEqual(snap)
    expect(fetchMock.mock.calls[0]?.[0]).toContain("agent=550e8400")
  })

  it("patchScopePolicyForAgent sends agent body", async () => {
    const snap = {
      policies: { message: "allow", update: "ask", close: "ask" },
      sources: { message: "agent", update: "default", close: "default" },
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snap })
    vi.stubGlobal("fetch", fetchMock)
    await patchScopePolicyForAgent({
      agent: "550e8400-e29b-41d4-a716-446655440000",
      policies: { message: "allow" },
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      agent: "550e8400-e29b-41d4-a716-446655440000",
      policies: { message: "allow" },
    })
  })
})
