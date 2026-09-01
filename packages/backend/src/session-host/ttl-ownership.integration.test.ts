/**
 * ttl-ownership.integration.test.ts — the real AgentSessionRegistry, the real
 * PatchesBroadcaster, the real GET /events route, exercising the actual TTL
 * sweep (not a mocked one).
 *
 * Testing: integration (brief §Commit 3)
 *
 * Why a new file and not an extension of session-host-http.integration.test.ts:
 * that file builds a HAND-ROLLED registry object literal (an
 * AgentSessionRegistry implemented inline), so the sweep — which lives
 * INSIDE createAgentSessionRegistry — never runs there at all. This file is
 * the only one in the repo that runs the real sweep against a real HTTP
 * route.
 *
 * What's real / what's faked:
 *   - createAgentSessionRegistry — REAL, and WITHOUT `_httpOwnerTtlMs` (the
 *     default path — TTL comes from process.env.HTTP_OWNER_TTL_MS)
 *   - createPatchesBroadcaster   — REAL (no `_createBroadcasterFn`)
 *   - createSessionHostFromConnection — REAL, with `_createAcpClient` injected
 *   - registerEventsRoute on a real Hono() — REAL, driven via app.request()
 *   - ConnectionRegistry — a STATEFUL fake: markOwned/markDetached/getOwner/
 *     touchOwner/getLastSeenAt/getEpoch implement the real semantics
 *     (including ownershipEpoch++ and getLastSeenAt→null when there's no
 *     owner — connection-registry.ts's actual behaviour)
 *   - ProviderConnection — a mock (same as session-host-http.integration.test.ts)
 *
 * ─── slice ttl-ownership Commit 3 (integration) ───
 */

import type { AcpClient } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { setSelfBaseUrlForTests } from "../instances.js"
import { registerEventsRoute } from "./http/events.js"
import { createAgentSessionRegistry } from "./registry.js"
import { createSessionHostFromConnection, type SessionHostFromConnOptions } from "./session-host.js"

/**
 * 🔴 packages/backend/tsconfig.json sets `"types": []`, so the ambient
 * `Response` is ambiguous and every `res.status`/`res.body` is TS2339.
 * Copied verbatim from session-host-http.integration.test.ts / rpc.test.ts.
 */
type MockResponse = { status: number; body: ReadableStream<Uint8Array> | null }

/** Same technique as session-host-http.integration.test.ts's CapturedCallbacks. */
type CapturedCallbacks = Parameters<NonNullable<SessionHostFromConnOptions["_createAcpClient"]>>[1]

const AGENT_ID = "agent-1"
const AGENT_CWD = "/tmp/ttl-ownership-integration"

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockAcpClient(overrides: Partial<AcpClient> = {}): AcpClient {
  return {
    newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    conn: {} as AcpClient["conn"],
    capabilities: {},
    authMethods: [],
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({}),
    setSessionMode: vi.fn().mockResolvedValue({}),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as AcpClient
}

function makeMockConnection(): ProviderConnection {
  return {
    wire: {
      onLine: vi.fn(() => () => {}),
      write: vi.fn(() => true),
    },
    capabilities: {} as ProviderConnection["capabilities"],
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash: vi.fn((_cb: (info: BridgeCrashInfo) => void) => () => {}),
    close: vi.fn().mockResolvedValue(undefined),
    pid: null,
  } as unknown as ProviderConnection
}

/**
 * makeStatefulConnectionRegistry — a REAL-behaving ConnectionRegistry fake for
 * a single agentId. markOwned/markDetached/getOwner/touchOwner/getLastSeenAt/
 * getEpoch mirror connection-registry.ts's actual semantics: markOwned bumps
 * ownershipEpoch AND sets lastSeenAt; markDetached clears the owner but does
 * NOT reset the epoch; getLastSeenAt returns null when there's no owner. The
 * sweep's `if (lastSeen === null) continue` guard only means something if
 * this fake gets that null-when-unowned behaviour right.
 */
function makeStatefulConnectionRegistry(conn: ProviderConnection, cwd: string): ConnectionRegistry {
  const rows = new Map<string, { via: "ws" | "http"; lastSeenAt: number; stream?: ReadableStream<unknown> }>()
  let epoch = 0
  return {
    connect: vi.fn(),
    get: vi.fn(() => conn),
    getCwd: vi.fn(() => cwd),
    getCharter: vi.fn(() => undefined),
    consumeCharter: vi.fn(() => undefined),
    getCliKind: vi.fn(() => "opencode"),
    list: vi.fn(() => []),
    addConnection: vi.fn((_id: string, cid: string, via: "ws" | "http", stream?: ReadableStream<unknown>) => {
      const hadHttp = [...rows.values()].some((r) => r.via === "http")
      rows.set(cid, { via, lastSeenAt: Date.now(), stream })
      if (via === "http" && !hadHttp) epoch++
      if (via === "ws") epoch++
    }),
    removeConnection: vi.fn((_id: string, cid: string) => {
      rows.delete(cid)
    }),
    touchConnection: vi.fn((_id: string, cid: string) => {
      const row = rows.get(cid)
      if (row) row.lastSeenAt = Date.now()
    }),
    clearAllConnections: vi.fn(() => rows.clear()),
    getConnectionCount: vi.fn(() => rows.size),
    isAttached: vi.fn(() => rows.size > 0),
    getEpoch: vi.fn(() => epoch),
    isOwnedByWs: vi.fn(() => false),
    getRuntimeInfo: vi.fn(() => null),
    getLastSeenAt: vi.fn(() => {
      if (rows.size === 0) return null
      return Math.max(...[...rows.values()].map((r) => r.lastSeenAt))
    }),
    listHttpConnectionIds: vi.fn(() =>
      [...rows.entries()]
        .filter(([, r]) => r.via === "http")
        .map(([connectionId, r]) => ({ connectionId, lastSeenAt: r.lastSeenAt, stream: r.stream })),
    ),
    close: vi.fn().mockResolvedValue(undefined),
    onCrash: vi.fn(() => () => {}),
    setWsSocketChecker: vi.fn(),
  } as unknown as ConnectionRegistry
}

/** `app.request()` wrapped through MockResponse — see the type comment above. */
async function req(app: Hono, path: string, init?: RequestInit): Promise<MockResponse> {
  const res = await app.request(path, init)
  return res as unknown as MockResponse
}

type SseFrame = { event: string; data: unknown }

/**
 * makeSseReader — a persistent SSE reading session over a single response
 * body. Needed because a plain "read N frames then stop" helper (the
 * pattern in session-host-http.integration.test.ts) can't also observe the
 * stream ENDING later — calling `.getReader()` a second time on the same
 * body throws once a reader is attached. `readOne` and `watchUntilEnd` share
 * one `reader` + one in-flight `pending` read across calls, so a poll-timeout
 * on one call correctly hands the SAME outstanding read() to the next call
 * instead of racing a second, orphaned read() against it.
 */
function assertReader(
  r: ReadableStreamDefaultReader<Uint8Array> | undefined,
): ReadableStreamDefaultReader<Uint8Array> {
  if (!r) throw new Error("makeSseReader: response has no body")
  return r
}

function makeSseReader(response: MockResponse) {
  // 🔴 a helper with an explicit non-optional return type — not a plain
  // `if (!reader) throw` guard — because TS's control-flow narrowing does
  // not reliably persist into the nested `readOne`/`watchUntilEnd` closures
  // declared further down (TS18048 "possibly undefined" otherwise).
  const reader = assertReader(response.body?.getReader())
  const decoder = new TextDecoder()
  let buffer = ""
  let pending: ReturnType<typeof reader.read> | null = null

  function drainBuffer(): SseFrame[] {
    const out: SseFrame[] = []
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      if (!part.trim()) continue
      const eventLine = part.split("\n").find((l) => l.startsWith("event: "))
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "))
      if (!eventLine || !dataLine) continue
      out.push({
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)),
      })
    }
    return out
  }

  /** Reads until at least one frame is parsed, the stream ends, or timeoutMs elapses. */
  async function readOne(timeoutMs: number): Promise<SseFrame | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!pending) pending = reader.read()
      const raced = await Promise.race([
        pending.then((r) => ({ kind: "read" as const, r })),
        new Promise<{ kind: "poll" }>((resolve) => setTimeout(() => resolve({ kind: "poll" }), 50)),
      ])
      if (raced.kind === "poll") continue
      pending = null
      const { done, value } = raced.r
      if (done) return null
      buffer += decoder.decode(value, { stream: true })
      const frames = drainBuffer()
      if (frames.length > 0) return frames[0] ?? null
    }
    return null
  }

  /** Reads until the SERVER ends the stream (done:true) or timeoutMs elapses. */
  async function watchUntilEnd(timeoutMs: number): Promise<{ frames: SseFrame[]; ended: boolean }> {
    const collected: SseFrame[] = []
    const deadline = Date.now() + timeoutMs
    let ended = false
    while (Date.now() < deadline) {
      if (!pending) pending = reader.read()
      const raced = await Promise.race([
        pending.then((r) => ({ kind: "read" as const, r })),
        new Promise<{ kind: "poll" }>((resolve) => setTimeout(() => resolve({ kind: "poll" }), 50)),
      ])
      if (raced.kind === "poll") continue
      pending = null
      const { done, value } = raced.r
      if (done) {
        ended = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      collected.push(...drainBuffer())
    }
    return { frames: collected, ended }
  }

  return {
    readOne,
    watchUntilEnd,
    cancel: () => reader.cancel().catch(() => {}),
  }
}

// ── the test ──────────────────────────────────────────────────────────────────

describe("ttl-ownership integration (real registry + real broadcaster + real SSE route)", () => {
  // 🔴 500ms — NOT 60ms (brief §Commit 3): markOwned resets lastSeenAt, so the
  // second connection's re-claim restarts the TTL clock and it can expire
  // AGAIN before assertions 7-8 run. 500 keeps the whole test under a second
  // while leaving a comfortable margin over the ~150ms of real I/O involved.
  const TTL_MS = "500"

  beforeEach(() => {
    setSelfBaseUrlForTests("http://127.0.0.1:4055")
  })

  afterEach(() => {
    setSelfBaseUrlForTests(undefined)
  })

  it("TTL expiry over the real sweep + real SSE route is a continuation: ownership releases, the stream ends without taken-over, and a reconnect re-claims the SAME host without loadSession", {
    timeout: 15_000,
  }, async () => {
    const conn = makeMockConnection()
    const connectionRegistry = makeStatefulConnectionRegistry(conn, AGENT_CWD)
    const mockClient = makeMockAcpClient()
    let capturedCallbacks: CapturedCallbacks | undefined

    const registry = createAgentSessionRegistry({
      connectionRegistry,
      // 🔴 Not a mock host — a real host wrapped by a pass-through that adds
      // ONE field (_createAcpClient) and forwards the rest unchanged (brief
      // §Commit 3 "composition clarification": _createHostFn is the ONLY
      // seam AgentSessionRegistry exposes; there is no way to inject
      // _createAcpClient "through" the registry any other way).
      _createHostFn: (c, opts) =>
        createSessionHostFromConnection(c, {
          ...opts,
          _createAcpClient: async (_transport, callbacks) => {
            capturedCallbacks = callbacks
            return mockClient
          },
        }),
      // TTL itself is deliberately NOT injected — it must come from deps.env.
      // The sweep interval IS injected: real timers, but no reason to wait 30s.
      env: { HTTP_OWNER_TTL_MS: TTL_MS },
      _httpSweepMs: 20,
    })

    const app = new Hono()
    registerEventsRoute(app, registry, connectionRegistry)

    // ── 1. creation + a real update pushed through the captured callbacks ──
    const created = await registry.getOrCreateHost(AGENT_ID)
    if (!created.ok) throw new Error(`expected ok:true, got reason:"${created.reason}"`)
    const { host } = created.entry
    if (!capturedCallbacks) throw new Error("_createAcpClient was never called")

    capturedCallbacks.onUpdate?.({
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
        messageId: "m1",
      },
    } as Parameters<NonNullable<CapturedCallbacks["onUpdate"]>>[0])

    const V1 = host.state.version
    expect(V1).toBeGreaterThan(0)

    // ── 2. GET /events → snapshot frame carries V1 ──
    const res1 = await req(app, `/api/agents/${AGENT_ID}/events`)
    expect(res1.status).toBe(200)
    const sse1 = makeSseReader(res1)
    const snap1 = await sse1.readOne(1000)
    expect(snap1?.event).toBe("snapshot")
    expect((snap1?.data as { version: number }).version).toBe(V1)

    // ── 3. wait past the TTL: the server ends the body, with no taken-over ──
    const { frames: tailFrames, ended } = await sse1.watchUntilEnd(3000)
    expect(ended).toBe(true)
    expect(tailFrames.some((f) => f.event === "taken-over")).toBe(false)
    sse1.cancel()

    // ── 4. host + broadcaster survive ──
    expect(registry.getHost(AGENT_ID)).toBe(host)

    // ── 5. ownership is released ──
    expect(connectionRegistry.getConnectionCount(AGENT_ID)).toBe(0)

    // ── 6 + 7. reconnect is a continuation — same session, no second init ──
    const res2 = await req(app, `/api/agents/${AGENT_ID}/events`)
    expect(res2.status).toBe(200)
    const sse2 = makeSseReader(res2)
    const snap2 = await sse2.readOne(1000)
    const snap2Data = snap2?.data as { version: number; sessionId: string }
    expect(snap2Data.version).toBeGreaterThanOrEqual(V1)
    expect(snap2Data.sessionId).toBe("s1")
    sse2.cancel()

    expect(mockClient.loadSession).not.toHaveBeenCalled()
    expect(mockClient.newSession).toHaveBeenCalledTimes(1)

    // ── 8. ownership is re-claimed as http ──
    expect(connectionRegistry.getConnectionCount(AGENT_ID)).toBeGreaterThan(0)
  })
})
