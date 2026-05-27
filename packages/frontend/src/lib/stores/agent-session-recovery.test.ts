/**
 * agent-session-recovery.test.ts
 *
 * Verifies that connect() does a GET to /api/agents/<id> BEFORE opening the WS,
 * and routes 404 to recoverAgent() without ever calling connectToAgent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────────

const recoverAgentMock = vi.fn(async (_id: string) => {})
vi.mock("./agent-recovery", () => ({
  recoverAgent: (id: string) => recoverAgentMock(id),
}))

const connectToAgentMock = vi.fn()
vi.mock("$lib/acp/connect", () => ({
  connectToAgent: (...args: unknown[]) => connectToAgentMock(...args),
}))

import { createAgentSessionStore } from "./agent-session.svelte"

// ── Helpers ──────────────────────────────────────────────────────────────────

function fetchOnce(status: number, body: unknown = {}) {
  return vi.fn(
    async (url: string) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        url,
      }) as unknown as Response,
  )
}

beforeEach(() => {
  recoverAgentMock.mockClear()
  connectToAgentMock.mockClear()
  vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("uuid") })
  vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("connect() — GET /api/agents/<id> before WS", () => {
  it("on 404: calls recoverAgent and does NOT open WS", async () => {
    vi.stubGlobal("fetch", fetchOnce(404, { error: "agent not found" }))
    const store = createAgentSessionStore("old-id")
    await store.connect()
    expect(recoverAgentMock).toHaveBeenCalledWith("old-id")
    expect(connectToAgentMock).not.toHaveBeenCalled()
  })

  it("on 200: proceeds to connectToAgent", async () => {
    vi.stubGlobal("fetch", fetchOnce(200, { agent: { cwd: "/x", acpSessionId: undefined } }))
    // Make connectToAgent throw so we don't have to wire the full handshake.
    // We only care that it's reached at all.
    connectToAgentMock.mockRejectedValue(new Error("stop here"))
    const store = createAgentSessionStore("live-id")
    await store.connect()
    expect(recoverAgentMock).not.toHaveBeenCalled()
    expect(connectToAgentMock).toHaveBeenCalledTimes(1)
  })

  it("on 500: throws (sets error state) and does NOT call recoverAgent", async () => {
    vi.stubGlobal("fetch", fetchOnce(500, { error: "boom" }))
    const store = createAgentSessionStore("bad-id")
    await store.connect()
    expect(recoverAgentMock).not.toHaveBeenCalled()
    expect(connectToAgentMock).not.toHaveBeenCalled()
    expect(store.error).toMatch(/getAgent failed: 500/)
  })
})
