/**
 * session-lookup.test.ts — findSessionCwd adapter (slice fix-session-url-hijack C3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { findSessionCwd } from "./session-lookup.js"

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("findSessionCwd", () => {
  it("returns object on 200", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ cwd: "/proj", lastSeenAt: 99 }),
    } as Response)
    await expect(findSessionCwd("claude", "sess-a")).resolves.toEqual({
      cwd: "/proj",
      lastSeenAt: 99,
    })
  })

  it("returns null on 404", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response)
    await expect(findSessionCwd("claude", "missing")).resolves.toBeNull()
  })

  it("throws on 500", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "fail",
    } as Response)
    await expect(findSessionCwd("claude", "x")).rejects.toThrow(/500/)
  })
})