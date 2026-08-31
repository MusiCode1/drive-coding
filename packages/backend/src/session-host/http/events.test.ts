/**
 * events.test.ts — TDD tests for GET /api/agents/:id/events (C2).
 *
 * Testing: tdd (brief §C2)
 *
 * Tests:
 *   - 404 if connection not found (registry.getOrCreateHost → {ok:false, reason})
 *   - 503 if the failure reason is "evict-timeout" (transient — slice host-result-reason C1)
 *   - SSE response headers (Content-Type: text/event-stream)
 *   - snapshot as first frame (event: snapshot)
 *   - patches streamed as subsequent frames (event: patch)
 *   - register-then-snapshot order (snapshot read before filtered subscribe)
 *   - client disconnect → broadcaster.unsubscribe called
 */

import type { Patch, SessionState } from "@drive-coding/core/session"
import {
  createInitialSessionState,
  STREAM_ALIVE_INTERVAL_MS,
  StreamAliveNotification,
} from "@drive-coding/core/session"
import { type } from "arktype"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import type { PatchesBroadcaster } from "../patches-broadcaster.js"
import { createPatchesBroadcaster } from "../patches-broadcaster.js"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { type RegisterEventsRouteOptions, registerEventsRoute } from "./events.js"

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...createInitialSessionState({ sessionId: null }), ...overrides }
}

function makeMockHost(state: SessionState): ExtendedSessionHost {
  const patches = new ReadableStream<Patch>({ start() {} })
  return {
    state,
    patches,
    prompt: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    cancel: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setConfigOption: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    agentCapabilities: {},
  }
}

function makeMockBroadcaster(patchStream?: ReadableStream<Patch>): PatchesBroadcaster {
  const stream = patchStream ?? new ReadableStream<Patch>({ start() {} })
  const subscribeFn = vi.fn().mockReturnValue(stream)
  const unsubscribeFn = vi.fn()
  const closeFn = vi.fn()
  return {
    subscribe: subscribeFn,
    unsubscribe: unsubscribeFn,
    close: closeFn,
  }
}

function makeMockRegistry(
  opts: { agentId?: string; host?: ExtendedSessionHost; broadcaster?: PatchesBroadcaster } = {},
): AgentSessionRegistry {
  const { host, broadcaster } = opts
  // slice host-result-reason C1: getOrCreateHost now resolves a discriminated
  // HostResult, not HostEntry | undefined — vi.fn() is untyped (`any`), so
  // getting this shape wrong would pass typecheck silently and fail at runtime
  // (result.ok undefined ⇒ treated as failure even on the success path).
  const result: HostResult =
    host && broadcaster
      ? { ok: true, entry: { host, broadcaster } }
      : { ok: false, reason: "not-found" }

  return {
    getHost: vi.fn().mockReturnValue(host),
    isHeld: vi.fn().mockReturnValue(Boolean(host)),
    getOrCreateHost: vi.fn().mockResolvedValue(result),
    getBroadcaster: vi.fn().mockReturnValue(broadcaster),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
    getCwd: vi.fn().mockReturnValue(undefined),
    getCliKind: vi.fn(),
    getEpoch: vi.fn().mockReturnValue(0),
    touchConnection: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue(null),
    getConnectionCount: vi.fn().mockReturnValue(0),
    stop: vi.fn(),
  }
}

function makeMockConnectionRegistry(): ConnectionRegistry {
  return {
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    touchConnection: vi.fn(),
    clearAllConnections: vi.fn(),
    getConnectionCount: vi.fn(() => 0),
    connect: vi.fn(),
    get: vi.fn(),
    getCwd: vi.fn(),
    getCliKind: vi.fn(),
    list: vi.fn(() => []),
    isAttached: vi.fn(() => false),
    getEpoch: vi.fn(() => 0),
    isOwnedByWs: vi.fn(() => false),
    getRuntimeInfo: vi.fn(() => null),
    getLastSeenAt: vi.fn(() => null),
    listHttpConnectionIds: vi.fn(() => []),
    close: vi.fn(),
    onCrash: vi.fn(() => () => {}),
    setWsSocketChecker: vi.fn(),
  }
}

/** Helper: read SSE text from a response body (stops after first N events) */
async function readSseEvents(
  response: Response,
  expectedEvents: number,
  timeoutMs = 300,
): Promise<string[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const events: string[] = []

  const deadline = Date.now() + timeoutMs
  while (events.length < expectedEvents && Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 50),
      ),
    ])
    if (result.done) break
    buffer += decoder.decode(result.value, { stream: true })
    // Split on double-newline (SSE frame delimiter)
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      if (part.trim()) events.push(part.trim())
    }
  }
  reader.cancel()
  return events
}

/**
 * Helper: reads raw SSE text off a live response body without ever calling
 * `reader.cancel()` — used by the keepalive-timer tests below, which need to
 * read the response in TWO stages (snapshot, then manually-fired keepalive
 * ticks) over the same underlying stream.
 */
function makeRawSseReader(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  async function readUntil(predicate: (buf: string) => boolean, timeoutMs = 300): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (!predicate(buffer) && Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 20),
        ),
      ])
      if (result.done) break
      if (result.value) buffer += decoder.decode(result.value, { stream: true })
    }
    return buffer
  }

  return { readUntil, cancel: () => reader.cancel() }
}

// ── test setup ─────────────────────────────────────────────────────────────────

function makeApp(registry: AgentSessionRegistry, opts?: RegisterEventsRouteOptions): Hono {
  const app = new Hono()
  registerEventsRoute(app, registry, makeMockConnectionRegistry(), opts)
  return app
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/agents/:id/events", () => {
  describe("404 when connection not found", () => {
    it("returns 404 if registry.getOrCreateHost resolves {ok:false, reason:'not-found'}", async () => {
      const registry = makeMockRegistry() // getOrCreateHost → {ok:false, reason:"not-found"}
      const app = makeApp(registry)

      const res = await app.request("/api/agents/missing-agent/events")
      expect(res.status).toBe(404)
    })
  })

  // ─── slice host-result-reason C1: evict-timeout is TRANSIENT → 503, not 404 ───
  describe("503 when eviction of a stuck WS owner times out", () => {
    it("returns 503 (not 404) when getOrCreateHost resolves {ok:false, reason:'evict-timeout'}", async () => {
      const registry = makeMockRegistry()
      ;(registry.getOrCreateHost as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        reason: "evict-timeout",
      })
      const app = makeApp(registry)

      const res = await app.request("/api/agents/stuck-agent/events")
      expect(res.status).toBe(503)
    })

    // slice host-result-reason C1 §6 DoD 4 — mutation check: mapping evict-timeout
    // back to 404 must fail this test. Documented (not committed) in the brief
    // report: reverting `result.reason === "evict-timeout" ? 503 : 404` to a
    // flat `404` turns this assertion red.
    it("still returns 404 for the three FINAL reasons (not-found/conn-dead/ws-owned) — unchanged", async () => {
      const registry = makeMockRegistry()
      for (const reason of ["not-found", "conn-dead", "ws-owned"] as const) {
        ;(registry.getOrCreateHost as ReturnType<typeof vi.fn>).mockResolvedValue({
          ok: false,
          reason,
        })
        const app = makeApp(registry)
        const res = await app.request("/api/agents/some-agent/events")
        expect(res.status).toBe(404)
      }
    })
  })

  describe("SSE response setup", () => {
    it("returns 200 with text/event-stream content-type", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      const broadcaster = makeMockBroadcaster()
      const registry = makeMockRegistry({ host, broadcaster })
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/event-stream")
    })

    it("calls registry.getOrCreateHost with the agentId from the URL", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      const broadcaster = makeMockBroadcaster()
      const registry = makeMockRegistry({ host, broadcaster })
      const app = makeApp(registry)

      await app.request("/api/agents/specific-agent/events")
      expect(registry.getOrCreateHost).toHaveBeenCalledWith("specific-agent")
    })
  })

  describe("snapshot-then-filtered-subscribe", () => {
    it("reads host.state before subscribe, passes snapshot.version, with no await between", async () => {
      const callOrder: string[] = []
      const state = makeMockState({ title: "Test Session", version: 7 })

      const subscribeStream = new ReadableStream<Patch>({ start() {} })
      const broadcaster: PatchesBroadcaster = {
        subscribe: vi.fn().mockImplementation((sinceVersion?: number) => {
          callOrder.push(`subscribe:${sinceVersion ?? "all"}`)
          return subscribeStream
        }),
        unsubscribe: vi.fn(),
        close: vi.fn(),
      }

      const host: ExtendedSessionHost = {
        get state() {
          callOrder.push("read-state")
          return state
        },
        patches: new ReadableStream({ start() {} }),
        prompt: vi.fn().mockResolvedValue(undefined),
        newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
        loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
        cancel: vi.fn().mockResolvedValue(undefined),
        setMode: vi.fn().mockResolvedValue(undefined),
        setConfigOption: vi.fn().mockResolvedValue(undefined),
        setSessionModel: vi.fn().mockResolvedValue(undefined),
        extMethod: vi.fn().mockResolvedValue({}),
        respondPermission: vi.fn(),
        respondElicitation: vi.fn(),
        listSessions: vi.fn().mockResolvedValue({}),
        deleteSession: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
        agentCapabilities: {},
      }

      const registry = makeMockRegistry({ host, broadcaster })
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")
      await readSseEvents(res, 1, 200)

      const readIdx = callOrder.indexOf("read-state")
      const subscribeIdx = callOrder.indexOf("subscribe:7")
      expect(readIdx).toBeGreaterThanOrEqual(0)
      expect(subscribeIdx).toBeGreaterThan(readIdx)
      expect(broadcaster.subscribe).toHaveBeenCalledWith(7)
    })
  })

  describe("snapshot as frame-zero", () => {
    it("sends snapshot as first SSE event with event: snapshot", async () => {
      const state = makeMockState({ title: "Hello World", version: 5 })
      const host = makeMockHost(state)
      const broadcaster = makeMockBroadcaster()
      const registry = makeMockRegistry({ host, broadcaster })
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")
      const events = await readSseEvents(res, 1, 200)

      expect(events.length).toBeGreaterThanOrEqual(1)
      const first = events[0]!
      expect(first).toContain("event: snapshot")
      expect(first).toContain("data: ")

      // Extract JSON from the data line
      const dataLine = first.split("\n").find((l) => l.startsWith("data: "))
      expect(dataLine).toBeDefined()
      const json = JSON.parse(dataLine!.slice("data: ".length))
      // ─── slice acp-wire-session-update ───
      // ה-snapshot אינו `SessionState` גולמי יותר אלא **רצף `session/update`**.
      // ‏`version` נשאר בשורש (הוא מונה-תעבורה, לא מצב-סשן); `title` נוסע
      // בתוך `session_info_update` — כלומר כפי שהפרוטוקול מבטא אותו.
      expect(json.version).toBe(5)
      const info = (json.updates as Array<Record<string, unknown>>).find(
        (u) => u.sessionUpdate === "session_info_update",
      )
      expect(info?.title).toBe("Hello World")
    })
  })

  describe("patch streaming", () => {
    it("sends patch events after the snapshot", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)

      // Controlled patch stream
      let ctrl!: ReadableStreamDefaultController<Patch>
      const patchStream = new ReadableStream<Patch>({
        start(c) {
          ctrl = c
        },
      })
      const broadcaster = makeMockBroadcaster(patchStream)
      const registry = makeMockRegistry({ host, broadcaster })
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")

      // Push a patch after a tick
      setTimeout(() => {
        ctrl.enqueue({ version: 1, op: "update-session", changes: { title: "Updated" } })
      }, 10)

      const events = await readSseEvents(res, 2, 300)
      expect(events.length).toBeGreaterThanOrEqual(2)

      // ─── slice acp-wire-session-update ───
      // הפריים הוא `event: update`, ה-`version` יושב ב-`id:`, וה-`data` הוא
      // **batch של JSON-RPC** — patch אחד יכול להתפצל לכמה `session/update`.
      const updateEvent = events.find((e) => e.includes("event: update"))
      expect(updateEvent).toBeDefined()
      expect(updateEvent).toContain("id: 1")
      const dataLine = updateEvent!.split("\n").find((l) => l.startsWith("data: "))
      const batch = JSON.parse(dataLine!.slice("data: ".length)) as Array<{
        jsonrpc: string
        method: string
        params: { update: { sessionUpdate: string; title?: string } }
      }>
      expect(batch[0]!.jsonrpc).toBe("2.0")
      expect(batch[0]!.method).toBe("session/update")
      expect(batch[0]!.params.update.sessionUpdate).toBe("session_info_update")
      expect(batch[0]!.params.update.title).toBe("Updated")
    })
  })
})

// ── slice ownership-handoff C3: epoch guard + taken-over ─────────────────────

describe("GET /api/agents/:id/events — ownership-handoff C3", () => {
  describe("epoch guard", () => {
    it("returns 409 when client epoch is less than server epoch (stale client)", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      const broadcaster = makeMockBroadcaster()
      const registry = makeMockRegistry({ host, broadcaster })
      // Simulate server epoch = 2
      ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockReturnValue(2)
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events?epoch=1")
      expect(res.status).toBe(409)
      // Stale check must happen BEFORE getOrCreateHost
      expect(registry.getOrCreateHost).not.toHaveBeenCalled()
    })

    it("does not reject when client epoch equals server epoch", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      const broadcaster = makeMockBroadcaster()
      const registry = makeMockRegistry({ host, broadcaster })
      ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockReturnValue(1)
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events?epoch=1")
      expect(res.status).toBe(200)
    })

    it("proceeds normally without ?epoch query param", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      const broadcaster = makeMockBroadcaster()
      const registry = makeMockRegistry({ host, broadcaster })
      ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockReturnValue(5)
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")
      expect(res.status).toBe(200)
    })
  })

  describe("snapshot frame-zero carries epoch as SSE id", () => {
    it("snapshot frame includes id: <epoch>", async () => {
      const state = makeMockState({ title: "EpochTest" })
      const host = makeMockHost(state)
      const broadcaster = makeMockBroadcaster()
      const registry = makeMockRegistry({ host, broadcaster })
      ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockReturnValue(3)
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")
      const events = await readSseEvents(res, 1, 200)

      expect(events.length).toBeGreaterThanOrEqual(1)
      const first = events[0]!
      expect(first).toContain("event: snapshot")
      // ⚠️ ה-`id:` הוא ה-**version** ולא ה-epoch. שני מונים שונים: ה-epoch
      // אומר *מי מחזיק בזרם*, וה-version אומר *איפה אנחנו ברצף* — ורק השני
      // הוא מה ש-`Last-Event-ID` יוכל להמשיך ממנו. ה-epoch עבר לגוף ההודעה.
      const epochData = first.split("\n").find((l) => l.startsWith("data: "))!
      expect(JSON.parse(epochData.slice("data: ".length)).epoch).toBe(3)
    })
  })

  describe("taken-over event when broadcaster ends with higher epoch", () => {
    it("sends taken-over event when broadcaster closes and epoch advanced", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)

      let ctrl!: ReadableStreamDefaultController<Patch>
      const patchStream = new ReadableStream<Patch>({
        start(c) {
          ctrl = c
        },
      })
      const broadcaster = makeMockBroadcaster(patchStream)

      const registry = makeMockRegistry({ host, broadcaster })
      // 🔴 sse-liveness r7: this used to be a callCount-based mock ("first call
      // =1, second call =2") that IMPLICITLY assumed the epoch had already
      // advanced by the time the route re-reads it — a test that cannot fail
      // even if that ordering assumption breaks in production (see Commit 3ב
      // below, which locks the REAL ordering with a real broadcaster instead
      // of faking it here). This test is scoped narrower on purpose: it only
      // exercises events.ts's OWN branching logic — "IF the epoch read after
      // `done` is higher than the epoch read at connection time, THEN emit
      // taken-over with the new epoch" — via a mutable flag driven explicitly
      // by the test, not by an opaque call count.
      let epochAdvanced = false
      ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockImplementation(() =>
        epochAdvanced ? 2 : 1,
      )
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")

      // Close the broadcaster after a tick (simulates host.dispose()) — epoch
      // is bumped in the SAME tick, mirroring the real caller (ws-agent.ts:
      // unregisterHost then markAttached, no await between them).
      setTimeout(() => {
        epochAdvanced = true
        ctrl.close()
      }, 10)

      const events = await readSseEvents(res, 2, 300)
      const takenOver = events.find((e) => e.includes("event: taken-over"))
      expect(takenOver).toBeDefined()
      expect(takenOver).toContain("id: 2")
    })

    it("does NOT send taken-over when broadcaster closes with same epoch (e.g. expiry, not takeover)", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)

      let ctrl!: ReadableStreamDefaultController<Patch>
      const patchStream = new ReadableStream<Patch>({
        start(c) {
          ctrl = c
        },
      })
      const broadcaster = makeMockBroadcaster(patchStream)

      const registry = makeMockRegistry({ host, broadcaster })
      // epoch stays at 1 throughout (no takeover)
      ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockReturnValue(1)
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")

      setTimeout(() => ctrl.close(), 10)

      const events = await readSseEvents(res, 2, 300)
      const takenOver = events.find((e) => e.includes("event: taken-over"))
      expect(takenOver).toBeUndefined()
    })
  })
})

// ─── slice sse-liveness Commit 3ב: taken-over ordering — real broadcaster ─────
// cascade, no epoch-order mock.
//
// "לא תיקון — נעילה" (brief §3, Commit 3ב): `taken-over` already works TODAY,
// via a real but UNDOCUMENTED microtask race — `unregisterHost` (called with
// zero `await`s before the epoch bump, ws-agent.ts) synchronously triggers
// `patches-broadcaster.ts`'s real `drain()` cascade once the source ends, and
// that cascade happens to resolve BEFORE the epoch bump's own continuation
// gets a turn. The mock above (`makeMockBroadcaster`) can never prove this —
// it fakes the broadcaster entirely. These two tests use a REAL
// `createPatchesBroadcaster` over a controllable source stream, and drive
// `getEpoch` from a plain mutable flag (not a call-counting mock) so nothing
// here can pass "by construction" — only by the real ordering actually holding.
describe("Commit 3ב (sse-liveness): taken-over ordering — real broadcaster, no order-mock", () => {
  /**
   * A host whose `dispose()` mimics the ONE thing session-host.ts's real
   * dispose() does that matters here — closing `patches`' controller (the
   * mechanism that lets `PatchesBroadcaster`'s `drain()` loop see `done` and
   * cascade to closing every subscriber). Standing up a full ACP handshake
   * (`createSessionHostFromConnection`) would exercise the same cascade with
   * none of the ordering properties different — irrelevant to what's being
   * locked here.
   */
  function makeDisposableHost(state: SessionState): ExtendedSessionHost {
    let ctrl!: ReadableStreamDefaultController<Patch>
    const patches = new ReadableStream<Patch>({
      start(c) {
        ctrl = c
      },
    })
    return {
      ...makeMockHost(state),
      patches,
      dispose: vi.fn(async () => {
        try {
          ctrl.close()
        } catch {
          // already closed
        }
      }),
    }
  }

  it("real dispose() (awaited) → unregisterHost → SYNCHRONOUS epoch bump (no await between the last two) — taken-over arrives with the new epoch", async () => {
    const state = makeMockState()
    const host = makeDisposableHost(state)
    const broadcaster = createPatchesBroadcaster(host.patches)

    let epoch = 1
    const registry = makeMockRegistry({ host, broadcaster })
    ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockImplementation(() => epoch)

    const app = makeApp(registry)
    const res = await app.request("/api/agents/agent-1/events")
    const sse = makeRawSseReader(res)
    await sse.readUntil((buf) => buf.includes("event: snapshot"))
    // give the route's subscriber loop a tick to actually reach its pending
    // reader.read() (same pattern as the mocked taken-over tests above).
    await new Promise((r) => setTimeout(r, 10))

    // ── the real ws-agent.ts sequence being locked: dispose (already awaited
    // by the caller) → unregisterHost → epoch bump, ZERO awaits between the
    // last two. ──
    await host.dispose()
    registry.unregisterHost("agent-1")
    epoch = 2

    const buffer = await sse.readUntil((buf) => buf.includes("event: taken-over"), 300)
    expect(buffer).toContain("event: taken-over")

    sse.cancel()
  })

  it("🔴 מוטציה: await מלאכותי בין unregisterHost לעדכון ה-epoch שובר את הסדר — taken-over לא נשלח", async () => {
    const state = makeMockState()
    const host = makeDisposableHost(state)
    const broadcaster = createPatchesBroadcaster(host.patches)

    let epoch = 1
    const registry = makeMockRegistry({ host, broadcaster })
    ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockImplementation(() => epoch)

    const app = makeApp(registry)
    const res = await app.request("/api/agents/agent-1/events")
    const sse = makeRawSseReader(res)
    await sse.readUntil((buf) => buf.includes("event: snapshot"))
    await new Promise((r) => setTimeout(r, 10))

    await host.dispose()
    registry.unregisterHost("agent-1")
    // 🔴 the mutation — an artificial await where the real code has none.
    await new Promise((r) => setTimeout(r, 0))
    epoch = 2

    const buffer = await sse.readUntil((buf) => buf.includes("event: taken-over"), 150)
    expect(buffer).not.toContain("event: taken-over")

    sse.cancel()
  })
})

// ─── slice host-result-reason C2: keepalive timer seam ────────────────────────
// The `setInterval`/`clearInterval` in registerEventsRoute are hardcoded
// globals with no way to test them without waiting real wall-clock time
// (KEEPALIVE_INTERVAL_MS = 30s). Injecting `_setInterval`/`_clearInterval`
// (same pattern as SSEReader's `_fetch`/`_sleep`/`_now`) makes both testable
// synchronously. Default (no opts) = the real global — production unchanged.

describe("keepalive timer (slice host-result-reason C2 — no real-time wait)", () => {
  it("slice sse-liveness Commit 2: fires a visible event: stream-alive frame carrying a valid _drive/streamAlive JSON-RPC notification, with no id:, on each manually-triggered tick", async () => {
    const state = makeMockState()
    const host = makeMockHost(state)
    const broadcaster = makeMockBroadcaster()
    const registry = makeMockRegistry({ host, broadcaster })

    let tick: (() => void) | undefined
    const _setInterval = vi.fn((fn: () => void) => {
      tick = fn
      return 0 as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval
    const _clearInterval = vi.fn() as unknown as typeof clearInterval

    const app = makeApp(registry, { _setInterval, _clearInterval })
    const res = await app.request("/api/agents/agent-1/events")
    const sse = makeRawSseReader(res)

    // Read past the snapshot — proves the stream callback has already run
    // registerEventsRoute's doSetInterval(...) call (registered BEFORE the
    // snapshot write), so `tick` is captured by the time we check it.
    await sse.readUntil((buf) => buf.includes("event: snapshot"))
    expect(_setInterval).toHaveBeenCalledTimes(1)
    expect(_setInterval).toHaveBeenCalledWith(expect.any(Function), STREAM_ALIVE_INTERVAL_MS)
    expect(tick).toBeDefined()

    // Fire 3 ticks SYNCHRONOUSLY — no real setTimeout/setInterval elapses.
    // If this test needed the real 30s interval to fire 3 times, it would
    // take 90 real seconds; this takes milliseconds.
    tick?.()
    tick?.()
    tick?.()

    const buffer = await sse.readUntil(
      (buf) => (buf.match(/event: stream-alive\n/g) ?? []).length >= 3,
    )
    const frames = buffer.split("\n\n").filter((f) => f.startsWith("event: stream-alive"))
    expect(frames.length).toBe(3)

    for (const frame of frames) {
      // no id: line — an id here would make a future Last-Event-ID reconnect
      // skip patches that were never actually received.
      expect(frame).not.toContain("id: ")
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "))
      expect(dataLine).toBeDefined()
      const parsed = JSON.parse(dataLine!.slice("data: ".length))
      const validated = StreamAliveNotification(parsed)
      expect(validated instanceof type.errors).toBe(false)
    }

    sse.cancel()
  })

  it("clears the interval in `finally` when the patch stream ends", async () => {
    const state = makeMockState()
    const host = makeMockHost(state)

    // Controlled patch stream — same technique as the taken-over tests above
    // (ctrl.close() ends the route's `while(true) reader.read()` loop, which
    // is what drives execution into the `finally` block that clears the timer).
    let ctrl!: ReadableStreamDefaultController<Patch>
    const patchStream = new ReadableStream<Patch>({
      start(c) {
        ctrl = c
      },
    })
    const broadcaster = makeMockBroadcaster(patchStream)
    const registry = makeMockRegistry({ host, broadcaster })

    const FAKE_TIMER_ID = 42 as unknown as ReturnType<typeof setInterval>
    const _setInterval = vi.fn(() => FAKE_TIMER_ID) as unknown as typeof setInterval
    const _clearInterval = vi.fn() as unknown as typeof clearInterval

    const app = makeApp(registry, { _setInterval, _clearInterval })
    const res = await app.request("/api/agents/agent-1/events")
    const sse = makeRawSseReader(res)

    await sse.readUntil((buf) => buf.includes("event: snapshot"))
    expect(_clearInterval).not.toHaveBeenCalled() // still connected

    // End the patch stream (host disposed / connection closed) — this is what
    // makes the route's reader.read() loop `break` and enter `finally`.
    ctrl.close()
    await sse.readUntil(() => false, 100) // pump the reader loop forward

    expect(_clearInterval).toHaveBeenCalledWith(FAKE_TIMER_ID)
    sse.cancel()
  })

  it("production default (no opts) uses the real global setInterval/clearInterval — unchanged behavior", async () => {
    const state = makeMockState()
    const host = makeMockHost(state)
    const broadcaster = makeMockBroadcaster()
    const registry = makeMockRegistry({ host, broadcaster })

    // No _setInterval/_clearInterval passed — makeApp(registry) with no opts.
    const app = makeApp(registry)
    const res = await app.request("/api/agents/agent-1/events")
    const sse = makeRawSseReader(res)

    await sse.readUntil((buf) => buf.includes("event: snapshot"))
    expect(res.status).toBe(200)

    sse.cancel()
  })
})
