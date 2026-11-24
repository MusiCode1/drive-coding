import { readFileSync } from "node:fs"
import type { QuotaSnapshot } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

const fixture: unknown = JSON.parse(
  readFileSync(
    new URL("../../../static/fixtures/session-budget-monthly.json", import.meta.url),
    "utf8",
  ),
)
const fetchMock = vi.fn(async (_url: string) => Response.json({ updates: [] }))

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({ updates: [] }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("AgentSession quota from the host", () => {
  const quota: QuotaSnapshot = { provider: "example", windows: [] }
  it("hydrates quota and receives subsequent quota changes", async () => {
    const host = hostSessionView({ quota })
    await host.view.connect()
    const session = new AgentSession({ view: host.view })
    try {
      expect(session.quota).toEqual(quota)
      host.send({ sessionUpdate: "_drive/session_update", changes: { quota: null } })
      await host.settle()
      expect(session.quota).toBeNull()
    } finally {
      await host.view.close()
    }
  })

  it("leaves the host quota intact when quota is opened", async () => {
    const host = hostSessionView({
      quota,
      capabilities: {
        mcp: false,
        compact: false,
        commands: false,
        usage: true,
        configOptions: false,
        rename: false,
        thinkingTokens: false,
        image: false,
      },
    })
    await host.view.connect()
    const session = new AgentSession({ view: host.view })
    session._setSessionContextForTest({
      sessionId: "test-session",
      cwd: "/project",
      cliKind: "codex",
    })
    try {
      host.send({ sessionUpdate: "_drive/session_update", changes: { quota } })
      await host.settle()
      expect(session.quota).toEqual(quota)
      const extMethod = vi.spyOn(host.view, "extMethod")
      await session.refreshQuota()
      expect(extMethod).not.toHaveBeenCalled()
      expect(session.quota).toEqual(quota)
      expect(session.quotaLoading).toBe(false)
    } finally {
      await host.view.close()
    }
  })
})

describe("AgentSession mock quota", () => {
  it("before open: quota=null even though a mock session is loaded", async () => {
    const session = new AgentSession()
    await session.openMockSession("session-budget-monthly", "/mock")
    session._setMockQuotaForTest({
      provider: "synthetic",
      windows: [
        {
          id: "monthly",
          period: { kind: "calendar", unit: "month" },
          consumption: { kind: "absolute", used: 40, limit: 100, unit: "requests" },
          resetsAtMs: null,
        },
      ],
    })

    expect(session.quota).toBeNull()
  })

  it("refreshQuota() copies the injected mock snapshot to quota, without calling ext", async () => {
    const session = new AgentSession()
    await session.openMockSession("session-budget-monthly", "/mock")
    const monthlySnapshot: QuotaSnapshot = {
      provider: "synthetic",
      windows: [
        {
          id: "monthly",
          period: { kind: "calendar", unit: "month" },
          consumption: { kind: "absolute", used: 40, limit: 100, unit: "requests" },
          resetsAtMs: null,
        },
      ],
    }
    session._setMockQuotaForTest(monthlySnapshot)

    await session.refreshQuota()

    expect(session.quota).toEqual(monthlySnapshot)
  })

  it("mock session with #mockQuota left undefined (no mockState.quota in fixture) → quota stays null, no ext", async () => {
    const session = new AgentSession()
    await session.openMockSession("greeting", "/mock")

    await session.refreshQuota()

    // no #mockQuota injected + no real #ext (mock path never creates one) → unavailable, no crash.
    expect(session.quota).toBeNull()
  })

  it("#mockQuota resets on #cleanup — does not leak into the next session", async () => {
    const session = new AgentSession()
    await session.openMockSession("session-budget-monthly", "/mock")
    session._setMockQuotaForTest({ provider: "synthetic", windows: [] })

    session.detach()

    // new mock session — #mockQuota must be undefined again (reset in #cleanup)
    await session.openMockSession("greeting", "/mock")
    await session.refreshQuota()

    expect(session.quota).toBeNull()
  })
})

describe("AgentSession — /chat?mock=session-budget-monthly data-flow-bridge (Commit 5 integration)", () => {
  /**
   * Proves the ACTUAL committed fixture round-trips through #loadMockSession's
   * mockState handling end-to-end: capabilities.usage merged from mockState →
   * supports.usage=true → refreshQuota() copies mockState.quota to `quota`, all
   * without an ext request. This is the "generic UI proof" data bridge from brief
   * §3 (Data Flow Bridges table, row "normalized snapshot | generic UI").
   */
  beforeEach(() => {
    fetchMock.mockImplementation(async (url) => {
      expect(url).toBe("/fixtures/session-budget-monthly.json")
      return Response.json(fixture)
    })
  })

  it("usage_update from the fixture populates contextUsage (context section proof)", async () => {
    const session = new AgentSession()
    await session.openMockSession("session-budget-monthly", "/mock")

    expect(session.contextUsage).toEqual({ used: 25_000, size: 200_000, cost: undefined })
  })

  it("mockState.capabilities merges into #capabilities — supports.usage becomes true", async () => {
    const session = new AgentSession()
    await session.openMockSession("session-budget-monthly", "/mock")

    expect(session.supports.usage).toBe(true)
    // regression: the merge uses safe defaults for the rest of NormalizedCapabilities —
    // it does not accidentally turn on other flags the fixture didn't request.
    expect(session.supports.compact).toBe(false)
    expect(session.supports.rename).toBe(false)
    expect(session.supports.thinkingTokens).toBe(false)
    expect(session.supports.mcp).toBe(false)
    expect(session.supports.configOptions).toBe(false)
    expect(session.supports.commands).toBe(false)
    expect(session.supports.image).toBe(false)
  })

  it("quota is null before refreshQuota() is called (open→refresh→render, not eager)", async () => {
    const session = new AgentSession()
    await session.openMockSession("session-budget-monthly", "/mock")

    expect(session.quota).toBeNull()
  })

  it("refreshQuota() populates the monthly calendar/absolute window from the fixture — no ext call", async () => {
    const session = new AgentSession()
    await session.openMockSession("session-budget-monthly", "/mock")

    await session.refreshQuota()

    expect(session.quota).toEqual({
      provider: "synthetic",
      windows: [
        {
          id: "monthly",
          period: { kind: "calendar", unit: "month" },
          consumption: { kind: "absolute", used: 40, limit: 100, unit: "requests" },
          resetsAtMs: null,
        },
      ],
    })
  })
})
