/**
 * session-host-http.integration.test.ts — end-to-end: real host + real
 * PatchesBroadcaster + real HTTP routes (S4 events/rpc/reply all wired
 * together via registerSessionHostHttp).
 *
 * Testing: integration (brief §C5)
 *
 * No existing file wires a real host + real broadcaster + real routes
 * together — events.test.ts / reply.test.ts / rpc.test.ts all mock the
 * registry+host, and session-host.integration.test.ts never touches HTTP.
 * This file closes that gap: it validates the chain end-to-end, purely
 * BE-side (no FE, no RemoteSessionView — that's S6's job once it's wired).
 *
 * Success criterion here is entirely BE-side: patches are emitted, the
 * snapshot carries the right state, and POST /reply closes the loop —
 * all measured in tests + SSE traffic, never on a screen.
 *
 * ─── slice session-host-pending-surface C5 (integration) ───
 */

import type { SessionState } from "@drive-coding/core/session"
import { createInitialSessionState, reduce } from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import { createPatchesBroadcaster } from "../patches-broadcaster.js"
import type { AgentSessionRegistry } from "../registry.js"
import {
  createSessionHostFromConnection,
  type ExtendedSessionHost,
  type SessionHostFromConnOptions,
} from "../session-host.js"
import { registerSessionHostHttp } from "./index.js"

/**
 * calev-heavy L10 (rpc.test.ts precedent): `app.request()` (Hono) declares its
 * return type in terms of the ambient global `Response`, which under this
 * package's tsconfig (`types: ["bun"]`) conflicts with DOM lib's `Response` —
 * every `.status`/`.body` access on the result is a TS2339 pre-existing in
 * this package. This local structural type sidesteps the ambiguous `Response`
 * name (same technique as rpc.test.ts's `MockResponse`).
 */
type MockResponse = { status: number; body: ReadableStream<Uint8Array> | null }

/**
 * calev-heavy L10 (session-host.integration.test.ts precedent): `@drive-coding/
 * provider/client`'s barrel does not re-export the `AcpClientCallbacks` type
 * name (a pre-existing package-resolution gap, not this slice's to fix) —
 * importing it by name is a TS2305 elsewhere in this same directory. Deriving
 * the callbacks type from `SessionHostFromConnOptions["_createAcpClient"]`
 * (which session-host.ts DOES export cleanly) sidesteps the gap entirely.
 */
type CapturedCallbacks = Parameters<NonNullable<SessionHostFromConnOptions["_createAcpClient"]>>[1]

// ── mock helpers (mirrors session-host.integration.test.ts — module convention:
// each integration test file builds its own minimal mocks, no shared util) ────

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

function makeMockConnection(): { conn: ProviderConnection } {
  const conn: ProviderConnection = {
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
  return { conn }
}

const AGENT_ID = "agent-1"

/**
 * setup — builds a REAL ExtendedSessionHost (createSessionHostFromConnection,
 * with an injected mock AcpClient — same technique as
 * session-host.integration.test.ts, to avoid the ACP initialize handshake) +
 * a REAL PatchesBroadcaster over host.patches, wired behind a hand-rolled
 * single-agent AgentSessionRegistry, then registers all 4 real HTTP routes
 * (events/rpc/reply/state) via registerSessionHostHttp on a real Hono app.
 */
async function setup(): Promise<{
  app: Hono
  host: ExtendedSessionHost
  mockClient: AcpClient
  callbacks: CapturedCallbacks
}> {
  const { conn } = makeMockConnection()
  let capturedCallbacks: CapturedCallbacks | undefined
  const mockClient = makeMockAcpClient()

  const host = await createSessionHostFromConnection(conn, {
    permissionTimeoutMs: 5000,
    elicitationTimeoutMs: 5000,
    _createAcpClient: async (_transport, callbacks) => {
      capturedCallbacks = callbacks
      return mockClient
    },
  })
  if (!capturedCallbacks) throw new Error("_createAcpClient was never called")

  const broadcaster = createPatchesBroadcaster(host.patches)

  const registry: AgentSessionRegistry = {
    getHost: (id) => (id === AGENT_ID ? host : undefined),
    isHeld: (id) => id === AGENT_ID,
    getOrCreateHost: async (id) =>
      id === AGENT_ID ? { ok: true, entry: { host, broadcaster } } : { ok: false, reason: "not-found" },
    getBroadcaster: (id) => (id === AGENT_ID ? broadcaster : undefined),
    unregisterHost: () => {},
    notifySessionAttached: async () => {},
    getCwd: (id) => (id === AGENT_ID ? "/connection/cwd" : undefined),
    getEpoch: (_id) => 0,
    touchOwner: (_id) => {},
    getRuntimeInfo: (_id) => null,
  }

  const app = new Hono()
  registerSessionHostHttp(app, { agentSessionRegistry: registry })

  return { app, host, mockClient, callbacks: capturedCallbacks }
}

/** Reads and parses SSE frames off a live GET /events response. */
async function readSseFrames(
  response: MockResponse,
  expectedFrames: number,
  timeoutMs = 500,
): Promise<Array<{ event: string; data: unknown; id: string }>> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const frames: Array<{ event: string; data: unknown; id: string }> = []

  const deadline = Date.now() + timeoutMs
  while (frames.length < expectedFrames && Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 50),
      ),
    ])
    if (result.done) break
    buffer += decoder.decode(result.value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      if (!part.trim()) continue
      const eventLine = part.split("\n").find((l) => l.startsWith("event: "))
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "))
      const idLine = part.split("\n").find((l) => l.startsWith("id: "))
      if (!eventLine || !dataLine) continue
      frames.push({
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)),
        // slice acp-wire-session-update: ה-`version` ירד מגוף ההודעה אל
        // שורת-המסגור, ולכן קורא-הפריימים חייב לשמור אותה.
        id: idLine === undefined ? "" : idLine.slice("id: ".length),
      })
    }
  }
  reader.cancel()
  return frames
}

/**
 * computeFinalClientState — mimics what a real SSE client (SSEReader +
 * RemoteSessionView) computes from the raw frame sequence: take the
 * snapshot as the base state, then apply every subsequent patch whose
 * version is STRICTLY GREATER than the snapshot's version (the drop-guard
 * — calev-heavy round-2 finding, landed in remote-session-view.ts). The
 * broadcaster's ring-buffer replay means a fresh subscriber typically
 * receives old patches (v1..vN) *after* the snapshot (already @vN) —
 * applying them again would be a no-op once the drop-guard is honored,
 * exactly like the real client. This is the "final state after replay",
 * per the brief — not frame-zero.
 */
function computeFinalClientState(
  frames: Array<{ event: string; data: unknown; id: string }>,
): SessionState {
  const first = frames[0]
  if (!first || first.event !== "snapshot") {
    throw new Error("expected the first SSE frame to be a snapshot")
  }
  // ─── slice acp-wire-session-update ───
  // הלקוח האמיתי אינו מקבל `SessionState` יותר אלא **רצף `session/update`**,
  // ומקפל אותו ב-`reduce` — אותו reducer שמסלול ה-WS משתמש בו. החיקוי כאן
  // עודכן לאותה צורה, ולכן הטסט מוכיח עכשיו את השרשרת המלאה:
  // ‏host אמיתי → broadcaster אמיתי → route אמיתית → הקיפול של הלקוח.
  const snap = first.data as { sessionId: string | null; version: number; updates: unknown[] }
  let state = createInitialSessionState({ sessionId: snap.sessionId ?? "" })
  for (const u of snap.updates) state = reduce(state, u).state
  state = { ...state, sessionId: snap.sessionId, version: snap.version }

  const snapshotVersion = snap.version
  for (const frame of frames.slice(1)) {
    if (frame.event !== "update") continue
    // ה-drop-guard, בדיוק כמו ב-remote-session-view: ה-ring-buffer של
    // ה-broadcaster משחזר patches ישנים למנוי חדש, והם כבר בתוך ה-snapshot.
    const version = Number(frame.id)
    if (!Number.isFinite(version) || version <= snapshotVersion) continue
    const batch = frame.data as Array<{ params: { update: unknown } }>
    for (const item of batch) state = reduce(state, item.params.update).state
    state = { ...state, version }
  }
  return state
}

/** `app.request()` wrapped through MockResponse — see the comment on the type above. */
async function req(app: Hono, path: string, init?: RequestInit): Promise<MockResponse> {
  const res = await app.request(path, init)
  return res as unknown as MockResponse
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("session-host HTTP end-to-end (real host + real broadcaster + real routes)", () => {
  it("a client connecting mid-pending-permission-request ends up, after replay, with pending.permission set correctly", async () => {
    const { app, host, callbacks } = await setup()

    // A permission request arrives before any client is connected — this is the
    // "pending request that predates the subscriber" scenario from the brief.
    const responsePromise = callbacks.onRequestPermission!({
      sessionId: "s1",
      toolCall: { toolCallId: "tc1", name: "run_bash", status: "pending" },
      options: [],
    } as Parameters<NonNullable<typeof callbacks.onRequestPermission>>[0])

    // give the broadcaster's background drain loop a tick to pick up the patch
    await new Promise((resolve) => setTimeout(resolve, 10))

    const res = await req(app, `/api/agents/${AGENT_ID}/events`)
    expect(res.status).toBe(200)
    // Only the snapshot frame is needed here: host.state already carries
    // pending.permission at the moment of subscribe (register-then-snapshot),
    // so frame-zero alone already reflects the final state in this scenario.
    const frames = await readSseFrames(res, 1, 300)
    const finalState = computeFinalClientState(frames)

    expect(finalState.pending.permission).toMatchObject({ requestId: 0 })

    // close the still-open request explicitly (avoids a dangling 5s timeout)
    host.respondPermission(0, { outcome: { outcome: "cancelled" } })
    await responsePromise
  })

  it("POST /reply closes the loop: respond* resolves the promise and every subscriber gets the cleanup patch with the same requestId", async () => {
    const { app, callbacks } = await setup()

    const responsePromise = callbacks.onRequestPermission!({
      sessionId: "s1",
      toolCall: { toolCallId: "tc1", name: "run_bash", status: "pending" },
      options: [],
    } as Parameters<NonNullable<typeof callbacks.onRequestPermission>>[0])
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Two independent subscribers, both connected before the reply.
    const resA = await req(app, `/api/agents/${AGENT_ID}/events`)
    const resB = await req(app, `/api/agents/${AGENT_ID}/events`)

    const replyRes = await req(app, `/api/agents/${AGENT_ID}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "permission",
        requestId: 0,
        result: { outcome: { outcome: "selected", optionId: "allow" } },
      }),
    })
    expect(replyRes.status).toBe(200)

    const response = await responsePromise
    expect(response.outcome.outcome).toBe("selected")

    // 3 frames each: snapshot@v1 (already carries pending) → replayed "set" patch
    // (v1, buffered before this subscriber connected) → live "clear" patch (v2).
    const framesA = await readSseFrames(resA, 3, 300)
    const framesB = await readSseFrames(resB, 3, 300)
    const finalA = computeFinalClientState(framesA)
    const finalB = computeFinalClientState(framesB)

    expect(finalA.pending.permission).toBeNull()
    expect(finalB.pending.permission).toBeNull()
  })

  it("a full turn (waiting→idle) is observed correctly by a subscriber that joined mid-turn", async () => {
    const { app, host, mockClient } = await setup()
    let resolvePrompt!: () => void
    ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => (resolvePrompt = resolve)),
    )

    const promptPromise = host.prompt("s1", "hello")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(host.state.turnState).toBe("waiting")

    const res = await req(app, `/api/agents/${AGENT_ID}/events`)
    const midTurnFrames = await readSseFrames(res, 1, 300)
    const midTurnState = computeFinalClientState(midTurnFrames)
    expect(midTurnState.turnState).toBe("waiting")

    resolvePrompt()
    await promptPromise
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(host.state.turnState).toBe("idle")
  })

  it("a failed turn reaches a subscriber that joined mid-turn, carrying lastTurnError", async () => {
    const { app, host, mockClient } = await setup()
    let rejectPrompt!: (e: unknown) => void
    ;(mockClient.prompt as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((_resolve, reject) => (rejectPrompt = reject)),
    )

    const promptPromise = host.prompt("s1", "boom").catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    const res = await req(app, `/api/agents/${AGENT_ID}/events`)

    rejectPrompt(new Error("agent crashed"))
    await promptPromise

    // 4 frames: snapshot@v2 (already turnState=waiting) → 2 replayed patches
    // (waiting v1, add-message v2 — hotfix order, both buffered before this
    // subscriber connected, both dropped by the version<=snapshot guard) →
    // the live idle+lastTurnError patch (v3) that only arrives after rejectPrompt.
    const frames = await readSseFrames(res, 4, 300)
    const finalState = computeFinalClientState(frames)
    expect(finalState.turnState).toBe("idle")
    expect(finalState.lastTurnError?.message).toBe("agent crashed")
  })
})
// ─── slice remote-session-mgmt C3: list/load/delete over the real route ───

type RpcResponse = { status: number; json(): Promise<unknown> }

async function postRpcIntegration(app: Hono, body: unknown): Promise<RpcResponse> {
  const res = await app.request(`/api/agents/${AGENT_ID}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res as unknown as RpcResponse
}

describe("session-host HTTP — remote-session-mgmt C3 (real host + real route)", () => {
  it("listSessions returns 200 {sessions, sessionCapabilities} from the real host", async () => {
    const { app, mockClient } = await setup()
    ;(mockClient.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [{ sessionId: "s1", cwd: "/connection/cwd" }],
    })

    const res = await postRpcIntegration(app, { method: "listSessions", params: {} })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sessions: unknown[]; sessionCapabilities: unknown }
    expect(json.sessions).toEqual([{ sessionId: "s1", cwd: "/connection/cwd" }])
    // mock client capabilities {} → sessionCapabilities absent → null
    expect(json.sessionCapabilities).toBeNull()
  })

  it("loadSession over the route switches the real host's session and returns {sessionId, version}", async () => {
    const { app, host, mockClient } = await setup()
    await host.newSession({ cwd: "/connection/cwd" }) // attach session "s1"
    ;(mockClient.loadSession as ReturnType<typeof vi.fn>).mockResolvedValue({ sessionId: "s2" })

    const res = await postRpcIntegration(app, {
      method: "loadSession",
      params: { sessionId: "s2", cwd: "/other/dir" },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sessionId: string; version: number }
    expect(json.sessionId).toBe("s2")
    expect(json.version).toBe(host.state.version)
    expect(host.state.sessionId).toBe("s2") // the switch landed on the real host
    expect(mockClient.loadSession).toHaveBeenCalledWith({ cwd: "/other/dir", sessionId: "s2" })
  })

  it("loadSession without params.cwd falls back to registry.getCwd (the connection's cwd)", async () => {
    const { app, host, mockClient } = await setup()
    await host.newSession({ cwd: "/connection/cwd" })

    const res = await postRpcIntegration(app, {
      method: "loadSession",
      params: { sessionId: "s2" },
    })
    expect(res.status).toBe(200)
    expect(mockClient.loadSession).toHaveBeenCalledWith({
      cwd: "/connection/cwd",
      sessionId: "s2",
    })
  })

  it("deleteSession happy path over the route → {ok:true}", async () => {
    const { app, mockClient } = await setup()

    const res = await postRpcIntegration(app, {
      method: "deleteSession",
      params: { sessionId: "s1" },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockClient.deleteSession).toHaveBeenCalledWith("s1")
  })

  it("deleteSession: -32601 from the CLI → 200 {ok:false, unsupported:true} (graceful, not 500)", async () => {
    const { app, mockClient } = await setup()
    ;(mockClient.deleteSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("Method not found"), { code: -32601 }),
    )

    const res = await postRpcIntegration(app, {
      method: "deleteSession",
      params: { sessionId: "s-x" },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, unsupported: true })
  })
})
