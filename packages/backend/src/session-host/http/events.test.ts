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
 *   - register-then-snapshot order (subscribe before snapshot)
 *   - client disconnect → broadcaster.unsubscribe called
 */

import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import type { Patch, SessionState } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import type { PatchesBroadcaster } from "../patches-broadcaster.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { registerEventsRoute } from "./events.js"

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
  return {
    subscribe: subscribeFn,
    unsubscribe: unsubscribeFn,
  }
}

function makeMockRegistry(opts: {
  agentId?: string
  host?: ExtendedSessionHost
  broadcaster?: PatchesBroadcaster
} = {}): AgentSessionRegistry {
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
    getEpoch: vi.fn().mockReturnValue(0),
    touchOwner: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue(null),
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

// ── test setup ─────────────────────────────────────────────────────────────────

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerEventsRoute(app, registry)
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

  describe("register-then-snapshot: subscribe before snapshot", () => {
    it("calls broadcaster.subscribe before reading host.state (snapshot)", async () => {
      const callOrder: string[] = []
      const state = makeMockState({ title: "Test Session" })

      // Track call order via custom getters
      const subscribeStream = new ReadableStream<Patch>({ start() {} })
      const broadcaster: PatchesBroadcaster = {
        subscribe: vi.fn().mockImplementation(() => {
          callOrder.push("subscribe")
          return subscribeStream
        }),
        unsubscribe: vi.fn(),
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
      // Read at least 1 event (the snapshot) to ensure route executed
      await readSseEvents(res, 1, 200)

      const subscribeIdx = callOrder.indexOf("subscribe")
      const stateIdx = callOrder.indexOf("read-state")
      expect(subscribeIdx).toBeGreaterThanOrEqual(0)
      expect(stateIdx).toBeGreaterThan(subscribeIdx) // subscribe BEFORE snapshot
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
      expect(json.title).toBe("Hello World")
      expect(json.version).toBe(5)
    })
  })

  describe("patch streaming", () => {
    it("sends patch events after the snapshot", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)

      // Controlled patch stream
      let ctrl!: ReadableStreamDefaultController<Patch>
      const patchStream = new ReadableStream<Patch>({
        start(c) { ctrl = c },
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

      const patchEvent = events.find((e) => e.includes("event: patch"))
      expect(patchEvent).toBeDefined()
      const dataLine = patchEvent!.split("\n").find((l) => l.startsWith("data: "))
      const json = JSON.parse(dataLine!.slice("data: ".length))
      expect(json.version).toBe(1)
      expect(json.op).toBe("update-session")
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
      expect(first).toContain("id: 3")
    })
  })

  describe("taken-over event when broadcaster ends with higher epoch", () => {
    it("sends taken-over event when broadcaster closes and epoch advanced", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)

      let ctrl!: ReadableStreamDefaultController<Patch>
      const patchStream = new ReadableStream<Patch>({ start(c) { ctrl = c } })
      const broadcaster = makeMockBroadcaster(patchStream)

      const registry = makeMockRegistry({ host, broadcaster })
      // epoch starts at 1, advances to 2 when broadcaster closes (simulating takeover)
      let callCount = 0
      ;(registry.getEpoch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++
        return callCount === 1 ? 1 : 2 // first call (snapshot time) = 1, second (after close) = 2
      })
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/events")

      // Close the broadcaster after a tick (simulates host.dispose())
      setTimeout(() => ctrl.close(), 10)

      const events = await readSseEvents(res, 2, 300)
      const takenOver = events.find((e) => e.includes("event: taken-over"))
      expect(takenOver).toBeDefined()
      expect(takenOver).toContain("id: 2")
    })

    it("does NOT send taken-over when broadcaster closes with same epoch (e.g. expiry, not takeover)", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)

      let ctrl!: ReadableStreamDefaultController<Patch>
      const patchStream = new ReadableStream<Patch>({ start(c) { ctrl = c } })
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
