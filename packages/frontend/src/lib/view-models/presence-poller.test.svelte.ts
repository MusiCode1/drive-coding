/**
 * presence-poller.test.svelte.ts — סקר presence (slice liveness C3/C4, DoD #14-17).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  _resetPageVisibilityForTest,
  _setPageHiddenForTest,
} from "$lib/util/page-visibility.svelte"
import {
  PRESENCE_BANNER_DELAY_MS,
  PRESENCE_INTERVAL_MS,
  PresencePoller,
} from "./presence-poller.svelte.js"

const mocks = vi.hoisted(() => ({
  postPresence: vi.fn(),
  notifySessionAttached: vi.fn(),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  postPresence: mocks.postPresence,
  notifySessionAttached: mocks.notifySessionAttached,
}))

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    status: "connected",
    agentId: "agent-1",
    sessionState: { sessionId: "sess-1" },
    ...overrides,
  } as import("./agent-session.svelte.js").AgentSession
}

describe("PresencePoller", () => {
  let poller: PresencePoller

  beforeEach(() => {
    vi.useFakeTimers()
    _resetPageVisibilityForTest()
    _setPageHiddenForTest(false)
    mocks.postPresence.mockReset()
    mocks.notifySessionAttached.mockReset()
    mocks.postPresence.mockResolvedValue({
      ok: true,
      agent: { attached: true, lastSeenAt: Date.now() },
      machine: null,
    })
    mocks.notifySessionAttached.mockResolvedValue(undefined)
    poller = new PresencePoller(makeSession())
    poller.init()
  })

  afterEach(() => {
    poller.dispose()
    vi.useRealTimers()
  })

  test("in-session visible: one request per tick, not in background", async () => {
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    expect(mocks.postPresence).toHaveBeenCalledTimes(1)

    mocks.postPresence.mockClear()
    _setPageHiddenForTest(true)
    poller.sync({ inSession: true, agentId: "agent-1", hidden: true })
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 2)
    expect(mocks.postPresence).not.toHaveBeenCalled()
  })

  test("interval fires every 12s while visible in session", async () => {
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    mocks.postPresence.mockClear()

    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS)
    expect(mocks.postPresence).toHaveBeenCalledTimes(1)
  })

  test("focus (visible) triggers immediate tick", async () => {
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await Promise.resolve()
    mocks.postPresence.mockClear()

    _setPageHiddenForTest(true)
    poller.sync({ inSession: true, agentId: "agent-1", hidden: true })
    _setPageHiddenForTest(false)
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await poller.tick("focus")
    expect(mocks.postPresence).toHaveBeenCalledTimes(1)
  })

  test("retakes ownership when attached=false after presence", async () => {
    mocks.postPresence.mockResolvedValue({
      ok: true,
      agent: { attached: false, lastSeenAt: null },
      machine: null,
    })
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()

    expect(mocks.notifySessionAttached).toHaveBeenCalledWith("agent-1", "sess-1", {
      replace: true,
    })
  })

  test("fast recovery: no banner within 5s", async () => {
    mocks.postPresence.mockRejectedValueOnce(new Error("network down"))
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()

    mocks.postPresence.mockResolvedValueOnce({
      ok: true,
      agent: { attached: true, lastSeenAt: Date.now() },
      machine: null,
    })
    await poller.tick("focus")
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(poller.banner).toBeNull()
  })

  test("failure >5s shows reconnecting banner", async () => {
    mocks.postPresence.mockRejectedValue(new Error("network down"))
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(poller.banner).toBe("reconnecting")
  })

  test("crashReason survives — banner is separate from session.error", async () => {
    const session = makeSession({ error: "ENOENT: claude binary not found" })
    const p = new PresencePoller(session)
    mocks.postPresence.mockRejectedValue(new Error("network down"))
    p.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(p.banner).toBe("reconnecting")
    expect(session.error).toBe("ENOENT: claude binary not found")
    p.dispose()
  })

  test("not in session: no requests (panel closed scenario — poller at layout level)", async () => {
    poller.sync({ inSession: false, agentId: null, hidden: false })
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 3)
    expect(mocks.postPresence).not.toHaveBeenCalled()
  })

  test("onSseReconnected clears banner", async () => {
    mocks.postPresence.mockRejectedValue(new Error("network down"))
    poller.sync({ inSession: true, agentId: "agent-1", hidden: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(PRESENCE_BANNER_DELAY_MS)
    expect(poller.banner).toBe("reconnecting")

    poller.onSseReconnected()
    expect(poller.banner).toBeNull()
  })
})
