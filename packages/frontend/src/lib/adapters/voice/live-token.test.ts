/**
 * live-token.test.ts — integration tests for fetchLiveToken (mocked fetch).
 *
 * Slice: live-ears, Commit 3.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchLiveToken } from "./live-token"

describe("fetchLiveToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("POSTs systemInstruction and action names from core", async () => {
    // params must be declared, else `mock.calls[0]` is typed as the empty tuple
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok",
        model: "gemini-3.1-flash-live-preview",
        sessionConfig: { foo: 1 },
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchLiveToken({ language: "he" })

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    const [, init] = call ?? []
    const body = JSON.parse(String(init?.body))
    expect(body.systemInstruction).toContain("מזכיר קולי")
    expect(body.actions).toContain("compose_prompt")
    expect(body.actions).toContain("cancel_turn")
    expect(result.token).toBe("tok")
    expect(result.sessionConfig).toEqual({ foo: 1 })
  })

  it("503 → friendly error, no throw on parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "no-api-key" }) })),
    )
    await expect(fetchLiveToken()).rejects.toThrow("live.token.noApiKey")
  })
})
