/**
 * agent-session.quota.test.svelte.ts — TDD עבור refreshQuota()/quota/quotaLoading
 * (slice-session-budget-meter, Commit 4).
 *
 * מראה מדויק של agent-session.context-usage.test.svelte.ts, עם mock ל-ExtClient
 * (getQuota) בנוסף ל-mock הקיים ל-createAcpClient.
 *
 * מכסה (§4 Commit 4 Tests):
 *   (א) params/result validation — ext.getQuota זורק על params/result לא תקינים (מכוסה
 *       ישירות ב-ext.test.ts; כאן רק מוודאים שה-VM מפיץ שגיאה כ-quota=null בלי קריסה)
 *   (ב) supported/unsupported — supports.usage=false → אין request
 *   (ג) success/null/error — quota מתעדכן, error → quota=null + quotaLoading מסתיים
 *   (ד) switch session בזמן promise pending — תשובה ישנה לא נכתבת
 *   (ה) שתי קריאות מקבילות — dedupe, extMethod נקרא פעם אחת
 *   (ו) cleanup בזמן request — לא כותב אחרי detach
 *   (ז) mock monthly harness — לפני open quota=null; refreshQuota() מציב את ה-snapshot
 *       הסינתטי; ext אינו נקרא
 *
 * Testing: TDD (red→green)
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient } from "@drive-coding/provider/client"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ─── Module-level mocks ───────────────────────────────────────────────────────

let capturedListener: ((n: SessionNotification) => void) | null = null
let capturedExtCallback: unknown = null

const mockClient = {
  prompt: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockResolvedValue({
    sessionId: "s-quota-test",
    configOptions: [],
    models: null,
    modes: null,
  }),
  loadSession: vi.fn().mockResolvedValue({ sessionId: "s-quota-test" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
  setSessionModel: vi.fn().mockResolvedValue(undefined),
  setSessionMode: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
}

// controllable getQuota mock — each test sets its own implementation
const getQuotaSpy = vi.fn<(sessionId: string) => Promise<QuotaSnapshot | null>>()

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      callbackOrCallbacks:
        | ((n: SessionNotification) => void)
        | { onUpdate: (n: SessionNotification) => void; onExtNotification?: unknown },
    ): Promise<AcpClient> {
      capturedListener =
        typeof callbackOrCallbacks === "function"
          ? callbackOrCallbacks
          : callbackOrCallbacks.onUpdate
      capturedExtCallback =
        typeof callbackOrCallbacks === "function" ? undefined : callbackOrCallbacks.onExtNotification
      return Promise.resolve(mockClient as unknown as AcpClient)
    }),
  }
})

// mock the ext facade — createExtClient returns an object whose getQuota delegates
// to the controllable spy. setThinkingTokens is unused in these tests but present
// for shape-compat with the real ExtClient type.
vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({
    setThinkingTokens: vi.fn().mockResolvedValue(undefined),
    getQuota: (sessionId: string) => getQuotaSpy(sessionId),
  })),
}))

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-quota-test" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.stubGlobal("location", {
  protocol: "http:",
  host: "localhost:5173",
  search: "",
})

vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("test-uuid") })

// #loadMockSession fetches /fixtures/<name>.json. Default stub returns minimal valid
// content (empty updates) for most tests — the mock-harness tests below inject #mockQuota
// directly via _setMockQuotaForTest, so the fixture body is usually irrelevant. The
// "real fixture" describe block at the bottom overrides this per-URL to serve the
// ACTUAL committed session-budget-monthly.json (Commit 5 data-flow-bridge integration test).
type MockFetchResponse = { ok: boolean; json: () => Promise<unknown> }
const fetchMock = vi.fn<(url: string) => Promise<MockFetchResponse>>(async (_url: string) => ({
  ok: true,
  json: async () => ({ updates: [] }),
}))
vi.stubGlobal("fetch", fetchMock)

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"
// slice session-budget-meter Commit 5: the real fixture — proves the committed JSON
// round-trips through #loadMockSession's mockState handling (data-flow-bridge integration).
import sessionBudgetMonthlyFixture from "../../../static/fixtures/session-budget-monthly.json"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLAUDE_CAPS = {
  mcp: false,
  compact: false,
  commands: false,
  usage: true,
  configOptions: false,
  rename: false,
  thinkingTokens: false,
  image: false,
}

/** יצירת AgentSession מחובר, עם capabilities.usage=true (Claude-like) */
async function buildConnectedSession(): Promise<AgentSession> {
  const session = new AgentSession()
  await session.attach({ cwd: "/tmp", cliKind: "opencode" })
  if (session.status !== "connected") {
    throw new Error(`attach failed: status=${session.status} error=${session.error}`)
  }
  // הזרקת capabilities דרך ה-ext notification callback האמיתי (כמו BE אמיתי)
  if (typeof capturedExtCallback === "function") {
    ;(capturedExtCallback as (m: string, p: Record<string, unknown>) => void)(
      "_drive/capabilities",
      CLAUDE_CAPS,
    )
  }
  return session
}

function makeDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedListener = null
  capturedExtCallback = null
  getQuotaSpy.mockReset()
  mockClient.newSession.mockResolvedValue({
    sessionId: "s-quota-test",
    configOptions: [],
    models: null,
    modes: null,
  })
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AgentSession — refreshQuota()", () => {
  it("supports.usage=false → no ext request, quota stays null", async () => {
    const session = await buildConnectedSession()
    // לא הזרקנו capabilities עם usage=true בטסט הזה — session חדש, supports.usage=false default
    const session2 = new AgentSession()
    await session2.attach({ cwd: "/tmp2", cliKind: "opencode" })

    await session2.refreshQuota()

    expect(getQuotaSpy).not.toHaveBeenCalled()
    expect(session2.quota).toBeNull()
    void session // keep first session referenced (attach side-effects only)
  })

  it("success — quota populated from ext.getQuota", async () => {
    const session = await buildConnectedSession()
    const snapshot: QuotaSnapshot = {
      provider: "claude",
      windows: [
        {
          id: "five_hour",
          period: { kind: "rolling", durationSeconds: 18_000 },
          consumption: { kind: "percentage", usedPct: 42 },
          resetsAtMs: null,
        },
      ],
    }
    getQuotaSpy.mockResolvedValue(snapshot)

    await session.refreshQuota()

    expect(getQuotaSpy).toHaveBeenCalledWith("s-quota-test")
    expect(session.quota).toEqual(snapshot)
    expect(session.quotaLoading).toBe(false)
  })

  it("null result — quota=null (valid 'no limits available' response, not an error)", async () => {
    const session = await buildConnectedSession()
    getQuotaSpy.mockResolvedValue(null)

    await session.refreshQuota()

    expect(session.quota).toBeNull()
    expect(session.quotaLoading).toBe(false)
  })

  it("error — quota=null, quotaLoading ends, no throw out of refreshQuota", async () => {
    const session = await buildConnectedSession()
    getQuotaSpy.mockRejectedValue(new Error("network error"))

    await expect(session.refreshQuota()).resolves.toBeUndefined()

    expect(session.quota).toBeNull()
    expect(session.quotaLoading).toBe(false)
  })

  it("quotaLoading is true while the request is pending", async () => {
    const session = await buildConnectedSession()
    const deferred = makeDeferred<QuotaSnapshot | null>()
    getQuotaSpy.mockReturnValue(deferred.promise)

    const p = session.refreshQuota()
    // סינכרוני-עד-await הראשון — quotaLoading כבר true לפני שה-promise resolve
    expect(session.quotaLoading).toBe(true)

    deferred.resolve(null)
    await p

    expect(session.quotaLoading).toBe(false)
  })

  it("dedupe — two concurrent refreshQuota() calls share one ext request", async () => {
    const session = await buildConnectedSession()
    const deferred = makeDeferred<QuotaSnapshot | null>()
    getQuotaSpy.mockReturnValue(deferred.promise)

    const p1 = session.refreshQuota()
    const p2 = session.refreshQuota()

    expect(getQuotaSpy).toHaveBeenCalledTimes(1)

    deferred.resolve(null)
    await Promise.all([p1, p2])

    expect(getQuotaSpy).toHaveBeenCalledTimes(1)
  })

  it("session switch while pending — stale response is not written", async () => {
    const session = await buildConnectedSession()
    const deferred = makeDeferred<QuotaSnapshot | null>()
    getQuotaSpy.mockReturnValue(deferred.promise)

    const p = session.refreshQuota()
    expect(session.quotaLoading).toBe(true)

    // switch session mid-flight (detach + attach) — #captureSessionConfig/#cleanup reset quota
    session.detach()
    mockClient.newSession.mockResolvedValue({
      sessionId: "s-quota-test-2",
      configOptions: [],
      models: null,
      modes: null,
    })
    await session.attach({ cwd: "/tmp3", cliKind: "opencode" })

    // stale response arrives AFTER the switch — must not overwrite the fresh (reset) state
    deferred.resolve({
      provider: "claude",
      windows: [
        {
          id: "seven_day",
          period: { kind: "rolling", durationSeconds: 604_800 },
          consumption: { kind: "percentage", usedPct: 99 },
          resetsAtMs: null,
        },
      ],
    })
    await p

    expect(session.quota).toBeNull()
  })

  it("cleanup (detach) while pending — stale response is not written, loading resets", async () => {
    const session = await buildConnectedSession()
    const deferred = makeDeferred<QuotaSnapshot | null>()
    getQuotaSpy.mockReturnValue(deferred.promise)

    const p = session.refreshQuota()
    session.detach()

    deferred.resolve({ provider: "claude", windows: [] })
    await p

    expect(session.quota).toBeNull()
    expect(session.quotaLoading).toBe(false)
  })
})

describe("AgentSession — refreshQuota() DEV mock harness", () => {
  // slice-session-budget-meter Commit 4: the mock harness plumbing itself (state +
  // refreshQuota copy-behavior) is tested here via _setMockQuotaForTest — a DEV-only
  // test hook (mirrors _setStatusForTest et al). The real fixture wiring (mockState.quota
  // → #mockQuota, mockState.capabilities merge) lands in Commit 5; this proves the
  // mechanism works independent of that wiring, per brief §4 Commit 4 "mock monthly" test.

  it("before open: quota=null even though a mock session is loaded", async () => {
    const session = new AgentSession()
    await session.loadSession({ sessionId: "mock:session-budget-monthly", cwd: "/mock", cliKind: "opencode" })
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
    await session.loadSession({ sessionId: "mock:session-budget-monthly", cwd: "/mock", cliKind: "opencode" })
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
    expect(getQuotaSpy).not.toHaveBeenCalled()
  })

  it("mock session with #mockQuota left undefined (no mockState.quota in fixture) → quota stays null, no ext", async () => {
    const session = new AgentSession()
    await session.loadSession({ sessionId: "mock:greeting", cwd: "/mock", cliKind: "opencode" })

    await session.refreshQuota()

    // no #mockQuota injected + no real #ext (mock path never creates one) → unavailable, no crash.
    expect(session.quota).toBeNull()
    expect(getQuotaSpy).not.toHaveBeenCalled()
  })

  it("#mockQuota resets on #cleanup — does not leak into the next session", async () => {
    const session = new AgentSession()
    await session.loadSession({ sessionId: "mock:session-budget-monthly", cwd: "/mock", cliKind: "opencode" })
    session._setMockQuotaForTest({ provider: "synthetic", windows: [] })

    session.detach()

    // new mock session — #mockQuota must be undefined again (reset in #cleanup)
    await session.loadSession({ sessionId: "mock:greeting", cwd: "/mock", cliKind: "opencode" })
    await session.refreshQuota()

    expect(session.quota).toBeNull()
    expect(getQuotaSpy).not.toHaveBeenCalled()
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
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("session-budget-monthly")) {
        return { ok: true, json: async () => sessionBudgetMonthlyFixture }
      }
      return { ok: true, json: async () => ({ updates: [] }) }
    })
  })

  afterEach(() => {
    // restore the default (empty-updates) stub for any test that runs after this block
    fetchMock.mockImplementation(async (_url: string) => ({
      ok: true,
      json: async () => ({ updates: [] }),
    }))
  })

  it("usage_update from the fixture populates contextUsage (context section proof)", async () => {
    const session = new AgentSession()
    await session.loadSession({
      sessionId: "mock:session-budget-monthly",
      cwd: "/mock",
      cliKind: "opencode",
    })

    expect(session.contextUsage).toEqual({ used: 25_000, size: 200_000, cost: undefined })
  })

  it("mockState.capabilities merges into #capabilities — supports.usage becomes true", async () => {
    const session = new AgentSession()
    await session.loadSession({
      sessionId: "mock:session-budget-monthly",
      cwd: "/mock",
      cliKind: "opencode",
    })

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
    await session.loadSession({
      sessionId: "mock:session-budget-monthly",
      cwd: "/mock",
      cliKind: "opencode",
    })

    expect(session.quota).toBeNull()
  })

  it("refreshQuota() populates the monthly calendar/absolute window from the fixture — no ext call", async () => {
    const session = new AgentSession()
    await session.loadSession({
      sessionId: "mock:session-budget-monthly",
      cwd: "/mock",
      cliKind: "opencode",
    })

    await session.refreshQuota()

    expect(getQuotaSpy).not.toHaveBeenCalled()
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
