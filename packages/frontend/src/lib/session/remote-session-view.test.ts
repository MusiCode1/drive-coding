/**
 * remote-session-view.test.ts — TDD עבור RemoteSessionView (C2 + C3).
 *
 * Testing: tdd (brief §C2, §C3)
 *
 * C2 tests:
 *   - connect(): fetches SSE, sets state from snapshot + sessionId
 *   - state updates as SSE patches stream in (via applyPatch מ-core)
 *   - patches: wraps each SSEReader Patch ל-[patch] array
 *   - prompt/cancel/setMode/setConfigOption/setSessionModel: POST /rpc עם sessionId
 *   - extMethod (fire-and-forget): POST /rpc, ack
 *   - extMethod (_drive/getQuota — צריך return value): throws "not supported in remote mode"
 *   - respond(): התאמה מדויקת מ-state.pending; id לא-מוכר = no-op
 *   - session management methods (newSession/loadSession/listSessions/deleteSession): throw
 *   - close(): סוגר SSE reader
 *
 * C3 tests:
 *   - water-mark advances on append-segment patches
 *   - reconnect mid-turn: snapshot.version > lastVersion → reset patch + water-mark reset
 *   - reconnect: snapshot.version <= lastVersion → skip (no reset patch)
 *
 * ─── slice session-host-pending-surface C4: respond() routing + JSDoc ───
 */

import type { Patch, SessionMessage, SessionState } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createRemoteSessionView,
  RemoteSessionView,
  type RemoteSessionViewOptions,
} from "./remote-session-view.js"

// ── helpers ──────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

/** Tracks every RemoteSessionView created via `newView()` so `afterEach` can close it. */
const activeViews: RemoteSessionView[] = []

function newView(
  agentId: string,
  baseUrl: string,
  opts: RemoteSessionViewOptions = {},
): RemoteSessionView {
  const view = new RemoteSessionView(agentId, baseUrl, opts)
  activeViews.push(view)
  return view
}

afterEach(() => {
  for (const view of activeViews) view.close()
  activeViews.length = 0
})

const noSleep = (): Promise<void> => Promise.resolve()

/**
 * sseBody — builds a mock SSE body. `keepOpen` (default false, matching the existing
 * tests in this file which close the view right after reading — see C1's diagnosis)
 * leaves the stream open instead of auto-closing, matching a real SSE connection that
 * stays open until disconnect. Needed by any test that keeps a reconnected connection
 * "steady" without triggering yet another reconnect (see B1 dedup test below — same
 * fix as remote-session-view.integration.test.svelte.ts).
 */
function sseBody(
  frames: Array<{ event: string; data: string }>,
  opts: { keepOpen?: boolean } = {},
): ReadableStream<Uint8Array> {
  const text = frames.map((f) => `event: ${f.event}\ndata: ${f.data}\n\n`).join("")
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(text))
      if (!opts.keepOpen) ctrl.close()
    },
  })
}

function sseResponse(
  frames: Array<{ event: string; data: string }>,
  opts: { keepOpen?: boolean } = {},
): Response {
  return { ok: true, status: 200, body: sseBody(frames, opts) } as unknown as Response
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function makeSnapshot(overrides: Partial<SessionState> = {}): SessionState {
  return { ...createInitialSessionState({ sessionId: "sess-1" }), ...overrides }
}

function makePatch(version: number, overrides: Partial<Patch> = {}): Patch {
  return { version, op: "update-session", changes: { status: "connected" }, ...overrides } as Patch
}

/**
 * Mock fetch that branches by URL:
 *   GET  .../events → SSE frames
 *   POST .../rpc     → {version} 202
 *   POST .../reply   → {ok:true} 200
 */
function makeMockFetch(opts: {
  events?: Array<{ event: string; data: string }>
  /** Keep the SSE stream open (default false — matches this file's existing tests). */
  keepOpen?: boolean
  onRpc?: (body: unknown) => void
  onReply?: (body: unknown) => void
}): (url: string, init?: RequestInit) => Promise<Response> {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/events")) {
      return sseResponse(
        opts.events ?? [{ event: "snapshot", data: JSON.stringify(makeSnapshot()) }],
        { keepOpen: opts.keepOpen },
      )
    }
    if (url.includes("/rpc")) {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      opts.onRpc?.(body)
      return jsonResponse({ version: 1 }, 202)
    }
    if (url.includes("/reply")) {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      opts.onReply?.(body)
      return jsonResponse({ ok: true }, 200)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** Read exactly n patch-arrays from the wrapped patches stream. */
async function readNPatchArrays(patches: ReadableStream<Patch[]>, n: number): Promise<Patch[][]> {
  const reader = patches.getReader()
  const results: Patch[][] = []
  try {
    for (let i = 0; i < n; i++) {
      const { value, done } = await reader.read()
      if (done) break
      if (value !== undefined) results.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return results
}

// ── connect() + state ────────────────────────────────────────────────────────

describe("RemoteSessionView — connect()", () => {
  it("fetches snapshot and sets state + sessionId", async () => {
    const snapshot = makeSnapshot({ sessionId: "sess-42" })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })

    await view.connect()

    expect(view.state.sessionId).toBe("sess-42")
    expect(mockFetch).toHaveBeenCalledWith(
      "http://be.local/api/agents/agent-1/events",
      expect.objectContaining({}),
    )
  })

  it("wraps SSE patches into [patch] arrays and updates state via core applyPatch", async () => {
    const snapshot = makeSnapshot()
    const patch = makePatch(1, { op: "update-session", changes: { title: "hello" } })
    const mockFetch = makeMockFetch({
      events: [
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "patch", data: JSON.stringify(patch) },
      ],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })

    await view.connect()
    const results = await readNPatchArrays(view.patches, 1)

    expect(results[0]).toEqual([patch])
    expect(view.state.title).toBe("hello")
    expect(view.state.version).toBe(1)
  })

  it("M8 (calev-heavy): connect() is re-entrant — a second call does not open a second SSE connection", async () => {
    const snapshot = makeSnapshot()
    const patch = makePatch(1, {
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "once" },
    })
    const mockFetch = makeMockFetch({
      keepOpen: true,
      events: [
        {
          event: "snapshot",
          data: JSON.stringify({
            ...snapshot,
            messages: [{ id: "m_0", role: "assistant", messageId: "p1", segments: [] }],
          }),
        },
        { event: "patch", data: JSON.stringify(patch) },
      ],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })

    // two concurrent connect() calls — must not open two SSE connections / drain loops
    await Promise.all([view.connect(), view.connect()])
    await readNPatchArrays(view.patches, 1)

    const calls = (mockFetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const eventsCalls = calls.filter(([url]) => typeof url === "string" && url.includes("/events"))
    expect(eventsCalls).toHaveLength(1)
    const msg = view.state.messages.find((m) => m.id === "m_0")
    expect(msg && msg.role !== "tool" ? msg.segments.map((s) => s.text) : []).toEqual(["once"])
  })

  // ─── round 2 finding #1: unknown patch op must not wipe state / kill the stream ───

  it("round 2 #1: an unknown patch op is a no-op — state survives, later patches still arrive", async () => {
    const snapshot = makeSnapshot({ title: "before" })
    const unknownOpPatch = { version: 1, op: "update-quota", quota: { used: 1 } }
    const goodPatch = makePatch(2, { op: "update-session", changes: { title: "after" } })
    const mockFetch = makeMockFetch({
      keepOpen: true,
      events: [
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "patch", data: JSON.stringify(unknownOpPatch) },
        { event: "patch", data: JSON.stringify(goodPatch) },
      ],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    // round 3 root-cause fix: SSEReader now validates patches at the wire
    // boundary (PatchSchema) before ever enqueueing them — the unknown-op patch
    // never reaches RemoteSessionView at all, so only the good patch arrives.
    // (Defense-in-depth in applyPatch/#applyIncoming/#drainPatches from round 2
    // still stands for any patch that somehow slips past validation.)
    const results = await readNPatchArrays(view.patches, 1)

    expect(view.state).not.toBeUndefined()
    expect(view.state.title).toBe("after")
    expect(results[0]?.[0]).toMatchObject({ version: 2, op: "update-session" })
  })

  // ─── round 2 finding #2: connect() must not memoize a rejected promise ───

  it("round 2 #2: a transient connect() failure does not permanently poison the view — retry succeeds", async () => {
    let call = 0
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (!url.includes("/events")) return jsonResponse({ ok: true })
      call++
      if (call === 1) {
        return { ok: false, status: 503 } as unknown as Response
      }
      return sseResponse([{ event: "snapshot", data: JSON.stringify(makeSnapshot()) }], {
        keepOpen: true,
      })
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })

    await expect(view.connect()).rejects.toThrow("503")
    // retry must make a real HTTP request, not replay the same rejection
    await expect(view.connect()).resolves.toBeUndefined()
    expect(call).toBe(2)
    expect(view.state.sessionId).toBe("sess-1")
  })

  // ─── round 2 finding #3: connect() after close() must not silently no-op ───

  it("round 2 #3: connect() after close() throws explicitly instead of silently no-op-ing", async () => {
    const mockFetch = makeMockFetch({ keepOpen: true })
    const view = new RemoteSessionView("agent-1", "http://be.local", {
      _fetch: mockFetch,
      _sleep: noSleep,
    })
    await view.connect()
    await view.close()

    await expect(view.connect()).rejects.toThrow(/closed|construct a new instance/i)
    // no new /events request was made for the post-close attempt
    const calls = (mockFetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const eventsCalls = calls.filter(([url]) => typeof url === "string" && url.includes("/events"))
    expect(eventsCalls).toHaveLength(1)
  })
})

// ── hydration בחיבור ראשון (warm reconnect — slice remote-warm-reconnect C3) ──

describe("RemoteSessionView — hydration on first connect (slice remote-warm-reconnect C3)", () => {
  /** מוודא שאין עוד פליטות בערוץ — כשל-כפילות: reset שני היה מכפיל את ההיסטוריה ב-VM. */
  async function expectNoMoreEmissions(patches: ReadableStream<Patch[]>, ms = 50): Promise<void> {
    const reader = patches.getReader()
    try {
      const result = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
      ])
      expect(result).toBe("timeout")
    } finally {
      reader.releaseLock()
    }
  }

  it("snapshot with history → emits exactly one synthetic reset patch (no duplication)", async () => {
    const messages: SessionMessage[] = [
      { id: "m_0", role: "user", messageId: null, segments: [{ id: "s_0", text: "hello" }] },
      {
        id: "m_1",
        role: "assistant",
        messageId: "p1",
        segments: [{ id: "s_1", text: "hi there" }],
      },
    ]
    const snapshot = makeSnapshot({ version: 7, messages, nextMessageSeq: 2, nextSegmentSeq: 2 })
    const mockFetch = makeMockFetch({
      keepOpen: true,
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })

    await view.connect()
    const results = await readNPatchArrays(view.patches, 1)

    expect(results).toHaveLength(1)
    expect(results[0]?.[0]).toMatchObject({
      op: "reset",
      version: 7,
      nextMessageSeq: 2,
      nextSegmentSeq: 2,
    })
    const emitted = results[0]?.[0]
    expect(emitted && emitted.op === "reset" ? emitted.messages : []).toEqual(messages)
    // פעם אחת בלבד — אין reset שני בערוץ (רגרסיית כפילות)
    await expectNoMoreEmissions(view.patches)
    // state עצמו נשאר ה-snapshot (הפליטה לא משנה state)
    expect(view.state.sessionId).toBe("sess-1")
    expect(view.state.messages).toHaveLength(2)
  })

  it("empty snapshot (fresh attachRemote) → no spurious reset patch", async () => {
    const snapshot = makeSnapshot({ version: 0 }) // messages: []
    const mockFetch = makeMockFetch({
      keepOpen: true,
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })

    await view.connect()

    await expectNoMoreEmissions(view.patches)
  })

  it("reset patch precedes live patches (deterministic order in the VM channel)", async () => {
    const snapshot = makeSnapshot({
      version: 3,
      messages: [{ id: "m_0", role: "assistant", messageId: "p1", segments: [] }],
    })
    const livePatch = makePatch(4, {
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "live" },
    })
    const mockFetch = makeMockFetch({
      keepOpen: true,
      events: [
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "patch", data: JSON.stringify(livePatch) },
      ],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })

    await view.connect()
    const results = await readNPatchArrays(view.patches, 2)

    expect(results[0]?.[0]?.op).toBe("reset") // hydration קודם — נפלט לפני drainPatches
    expect(results[1]?.[0]).toMatchObject({ op: "append-segment", version: 4 })
  })
})

// ── RPC methods ───────────────────────────────────────────────────────────────

describe("RemoteSessionView — RPC methods", () => {
  it("prompt() POSTs /rpc with sessionId + content + meta", async () => {
    let captured: unknown
    const mockFetch = makeMockFetch({ onRpc: (b) => (captured = b) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.prompt("hi there", { source: "voice" })

    expect(captured).toMatchObject({
      method: "prompt",
      params: { sessionId: "sess-1", content: "hi there", meta: { source: "voice" } },
    })
  })

  it("cancel() POSTs /rpc cancel with sessionId", async () => {
    let captured: unknown
    const mockFetch = makeMockFetch({ onRpc: (b) => (captured = b) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.cancel()

    expect(captured).toMatchObject({ method: "cancel", params: { sessionId: "sess-1" } })
  })

  it("setMode() POSTs /rpc setMode with sessionId + modeId", async () => {
    let captured: unknown
    const mockFetch = makeMockFetch({ onRpc: (b) => (captured = b) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.setMode("compact")

    expect(captured).toMatchObject({
      method: "setMode",
      params: { sessionId: "sess-1", modeId: "compact" },
    })
  })

  it("setConfigOption() POSTs /rpc setConfigOption with sessionId + configId + value", async () => {
    let captured: unknown
    const mockFetch = makeMockFetch({ onRpc: (b) => (captured = b) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.setConfigOption("verbosity", "high")

    expect(captured).toMatchObject({
      method: "setConfigOption",
      params: { sessionId: "sess-1", configId: "verbosity", value: "high" },
    })
  })

  it("setSessionModel() POSTs /rpc setSessionModel with sessionId + model", async () => {
    let captured: unknown
    const mockFetch = makeMockFetch({ onRpc: (b) => (captured = b) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.setSessionModel("claude-opus")

    expect(captured).toMatchObject({
      method: "setSessionModel",
      params: { sessionId: "sess-1", model: "claude-opus" },
    })
  })

  it("extMethod() for a fire-and-forget method POSTs /rpc and returns ack", async () => {
    let captured: unknown
    const mockFetch = makeMockFetch({ onRpc: (b) => (captured = b) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    const result = await view.extMethod("_drive/setThinkingTokens", { n: 100 })

    expect(captured).toMatchObject({
      method: "extMethod",
      params: { sessionId: "sess-1", method: "_drive/setThinkingTokens", params: { n: 100 } },
    })
    expect(result).toBeDefined()
  })

  it("extMethod() for a return-value method (_drive/getQuota) throws", async () => {
    const mockFetch = makeMockFetch({})
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await expect(view.extMethod("_drive/getQuota", { sessionId: "sess-1" })).rejects.toThrow(
      "not supported in remote mode",
    )
  })

  // ─── slice remote-images C1 (TDD) ───
  it("prompt() with PromptBlocks — passes blocks to RPC without throwing", async () => {
    let capturedParams: unknown = null
    const mockFetch = makeMockFetch({ onRpc: (params) => { capturedParams = params } })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    const blocks = [{ type: "image", mimeType: "image/png", data: "abc" }]
    await view.prompt(blocks as never)

    expect(capturedParams).toMatchObject({
      method: "prompt",
      params: { content: blocks },
    })
  })

  // ─── calev-heavy M4: HTTP errors must not be swallowed ───

  it("M4: setMode() throws when the BE responds with a non-2xx status (e.g. 500)", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/events")) {
        return sseResponse([{ event: "snapshot", data: JSON.stringify(makeSnapshot()) }])
      }
      if (url.includes("/rpc")) {
        return {
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "boom" }),
        } as unknown as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await expect(view.setMode("compact")).rejects.toThrow("500")
  })

  it("M4: prompt() throws on 404 (host not found)", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/events")) {
        return sseResponse([{ event: "snapshot", data: JSON.stringify(makeSnapshot()) }])
      }
      if (url.includes("/rpc")) {
        return {
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "not found" }),
        } as unknown as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await expect(view.prompt("hi")).rejects.toThrow("404")
  })
})

// ── respond() ─────────────────────────────────────────────────────────────────

describe("RemoteSessionView — respond()", () => {
  it("derives kind='permission' when pending.permission matches requestId", async () => {
    let captured: unknown
    const snapshot = makeSnapshot({
      pending: {
        permission: { requestId: 7, params: {} as never },
        elicitation: null,
      },
    })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
      onReply: (b) => (captured = b),
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.respond(7, { outcome: { outcome: "selected", optionId: "allow" } })

    expect(captured).toMatchObject({ kind: "permission", requestId: 7 })
  })

  it("derives kind='elicitation' when pending.elicitation matches requestId", async () => {
    let captured: unknown
    const snapshot = makeSnapshot({
      pending: {
        permission: null,
        elicitation: { requestId: 3, params: {} as never },
      },
    })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
      onReply: (b) => (captured = b),
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.respond(3, { action: "accept" })

    expect(captured).toMatchObject({ kind: "elicitation", requestId: 3 })
  })

  // slice session-host-pending-surface C4: the "prefers permission when both
  // pending share the same requestId" test used to live here — it described a
  // state that's no longer reachable in production once the BE moves to a
  // single shared requestId counter (session-host.ts C4): two different kinds
  // can never carry the same id. A test that only exercises an impossible
  // state is debt, not coverage — replaced below with the opposite: distinct
  // ids route to the correct kind each, exactly (no fallback).

  it("elicitation still routes correctly even while a permission with a different id is pending", async () => {
    let captured: unknown
    const snapshot = makeSnapshot({
      pending: {
        permission: { requestId: 5, params: {} as never },
        elicitation: { requestId: 6, params: {} as never },
      },
    })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
      onReply: (b) => (captured = b),
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.respond(6, {})

    expect(captured).toMatchObject({ kind: "elicitation", requestId: 6 })
  })

  it("respond() on an unknown requestId is a silent no-op — no HTTP request sent", async () => {
    const snapshot = makeSnapshot({
      pending: {
        permission: { requestId: 7, params: {} as never },
        elicitation: null,
      },
    })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    const callsBefore = (mockFetch as ReturnType<typeof vi.fn>).mock.calls.length
    await view.respond(999, {}) // no pending request carries this id
    expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
  })
})

// ── session management — newSession still throws; list/load/delete are real RPCs ──
// (slice remote-session-mgmt C4)

describe("RemoteSessionView — newSession still throws", () => {
  it("newSession() throws", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: makeMockFetch({}),
      _sleep: noSleep,
    })
    await expect(view.newSession()).rejects.toThrow("not supported in remote mode")
  })
})
// ─── slice remote-session-mgmt C4: listSessions/loadSession/deleteSession ───

describe("RemoteSessionView — session management over rpc (C4)", () => {
  /** Method-aware /rpc mock for the three blocking mappings. */
  function rpcFetchFor(opts: {
    listSessionsBody?: unknown
    listSessionsStatus?: number
    loadSessionBody?: unknown
    deleteSessionBody?: unknown
    onRpc?: (body: unknown) => void
  }): (url: string, init?: RequestInit) => Promise<Response> {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/events")) {
        // keepOpen: a closing stream would spin the noSleep reconnect loop and
        // #handleReconnected would keep resetting #state to the snapshot.
        return sseResponse(
          [{ event: "snapshot", data: JSON.stringify(makeSnapshot()) }],
          { keepOpen: true },
        )
      }
      if (url.includes("/rpc")) {
        const body = init?.body ? JSON.parse(init.body as string) : undefined
        opts.onRpc?.(body)
        const method = (body as { method?: string })?.method
        if (method === "listSessions") {
          const status = opts.listSessionsStatus ?? 200
          return jsonResponse(opts.listSessionsBody ?? { sessions: [] }, status)
        }
        if (method === "loadSession") {
          return jsonResponse(opts.loadSessionBody ?? { sessionId: "sess-2", version: 5 })
        }
        if (method === "deleteSession") {
          return jsonResponse(opts.deleteSessionBody ?? { ok: true })
        }
        return jsonResponse({ version: 1 }, 202)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  it("listSessions: sends method + normalizes sessions + stores sessionCapabilities", async () => {
    const seen: unknown[] = []
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({
        listSessionsBody: {
          sessions: [
            { sessionId: "a", cwd: "/a", title: "A" },
            { sessionId: "b", cwd: "/b" },
          ],
          sessionCapabilities: { delete: {} },
        },
        onRpc: (b) => seen.push(b),
      }),
      _sleep: noSleep,
    })
    await view.connect()

    const sessions = await view.listSessions()

    expect(seen[0]).toMatchObject({ method: "listSessions" })
    expect(sessions).toEqual([
      { sessionId: "a", cwd: "/a", title: "A", updatedAt: "" },
      { sessionId: "b", cwd: "/b", title: "", updatedAt: "" },
    ])
    expect(view.supportsSessionDelete).toBe(true)
  })

  it("supportsSessionDelete is false before any listSessions answer", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({}),
      _sleep: noSleep,
    })
    await view.connect()
    expect(view.supportsSessionDelete).toBe(false)
  })

  it("supportsSessionDelete is false when capabilities lack delete", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({
        listSessionsBody: { sessions: [], sessionCapabilities: { list: {} } },
      }),
      _sleep: noSleep,
    })
    await view.connect()
    await view.listSessions()
    expect(view.supportsSessionDelete).toBe(false)
  })

  it("listSessions: a 502 carrying code -32601 rejects with the code on the error", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({
        listSessionsStatus: 502,
        listSessionsBody: { error: "Method not found", code: -32601 },
      }),
      _sleep: noSleep,
    })
    await view.connect()

    const err = await view.listSessions().then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as { code?: number }).code).toBe(-32601)
    expect((err as Error).message).toContain("502")
  })

  it("loadSession: updates #sessionId and state.sessionId from the answer; sends cwd when provided", async () => {
    const seen: unknown[] = []
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({
        loadSessionBody: { sessionId: "sess-42", version: 7 },
        onRpc: (b) => seen.push(b),
      }),
      _sleep: noSleep,
    })
    await view.connect()
    expect(view.state.sessionId).toBe("sess-1") // from the snapshot

    await view.loadSession("sess-42", "/custom/cwd")

    expect(seen[0]).toMatchObject({
      method: "loadSession",
      params: { sessionId: "sess-42", cwd: "/custom/cwd" },
    })
    expect(view.state.sessionId).toBe("sess-42")
  })

  it("loadSession: omits cwd from params when not provided", async () => {
    const seen: unknown[] = []
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({
        loadSessionBody: { sessionId: "sess-42", version: 7 },
        onRpc: (b) => seen.push(b),
      }),
      _sleep: noSleep,
    })
    await view.connect()

    await view.loadSession("sess-42")

    expect((seen[0] as { params: Record<string, unknown> }).params).toEqual({
      sessionId: "sess-42",
    })
  })

  it("deleteSession: resolves on {ok:true}", async () => {
    const seen: unknown[] = []
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({ onRpc: (b) => seen.push(b) }),
      _sleep: noSleep,
    })
    await view.connect()

    await expect(view.deleteSession("sess-x")).resolves.toBeUndefined()
    expect(seen[0]).toMatchObject({
      method: "deleteSession",
      params: { sessionId: "sess-x" },
    })
  })

  it("deleteSession: {unsupported:true} rejects with code -32601 (VM handles gracefully like local)", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: rpcFetchFor({ deleteSessionBody: { ok: false, unsupported: true } }),
      _sleep: noSleep,
    })
    await view.connect()

    const err = await view.deleteSession("sess-x").then(
      () => null,
      (e) => e,
    )
    expect((err as { code?: number }).code).toBe(-32601)
  })

  it("a 502 on deleteSession rejects — not swallowed (M4 applies)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/events")) {
        return sseResponse([{ event: "snapshot", data: JSON.stringify(makeSnapshot()) }])
      }
      if (url.includes("/rpc")) {
        return jsonResponse({ error: "disk full", code: -32000 }, 502)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const view = newView("agent-1", "http://be.local", { _fetch: fetchMock, _sleep: noSleep })
    await view.connect()

    const err = await view.deleteSession("sess-x").then(
      () => null,
      (e) => e,
    )
    expect((err as Error).message).toContain("502")
    expect((err as { code?: number }).code).toBe(-32000)
  })
})

// ── close() ────────────────────────────────────────────────────────────────────

describe("RemoteSessionView — close()", () => {
  it("closes without throwing, even before connect()", async () => {
    const view = new RemoteSessionView("agent-1", "http://be.local", {
      _fetch: makeMockFetch({}),
      _sleep: noSleep,
    })
    await expect(view.close()).resolves.toBeUndefined()
  })

  it("cancels a pending permission via POST /reply before disconnecting (avigail #10)", async () => {
    let captured: unknown
    const snapshot = makeSnapshot({
      pending: { permission: { requestId: 4, params: {} as never }, elicitation: null },
    })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
      onReply: (b) => (captured = b),
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.close()

    expect(captured).toMatchObject({
      kind: "permission",
      requestId: 4,
      result: { outcome: { outcome: "cancelled" } },
    })
  })

  it("cancels a pending elicitation via POST /reply before disconnecting (avigail #10)", async () => {
    let captured: unknown
    const snapshot = makeSnapshot({
      pending: { permission: null, elicitation: { requestId: 8, params: {} as never } },
    })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
      onReply: (b) => (captured = b),
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.close()

    expect(captured).toMatchObject({
      kind: "elicitation",
      requestId: 8,
      result: { action: "cancel" },
    })
  })

  it("does not POST /reply on close() when nothing is pending", async () => {
    let replyCalled = false
    const mockFetch = makeMockFetch({ onReply: () => (replyCalled = true) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.close()

    expect(replyCalled).toBe(false)
  })
})

// ── C3: Speaker water-mark ────────────────────────────────────────────────────

describe("RemoteSessionView — Speaker water-mark", () => {
  it("advances lastReadMessageId/lastReadSegmentIndex on append-segment patches", async () => {
    const snapshot = makeSnapshot({
      messages: [{ id: "m_0", role: "assistant", messageId: "prov-1", segments: [] }],
      nextMessageSeq: 1,
    })
    const patch = makePatch(1, {
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "hello" },
    })
    const mockFetch = makeMockFetch({
      events: [
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "patch", data: JSON.stringify(patch) },
      ],
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()
    await readNPatchArrays(view.patches, 1)

    expect(view.lastReadMessageId).toBe("m_0")
    expect(view.lastReadSegmentIndex).toBe(0)
  })
})

// ── C3: reconnect mid-turn ─────────────────────────────────────────────────────

describe("RemoteSessionView — reconnect mid-turn", () => {
  it("snapshot.version > lastVersion after reconnect → emits reset patch + resets water-mark", async () => {
    const snapshot1 = makeSnapshot({ version: 1 })
    // version must be > snapshot1.version (2, not 1) — a patch's version is the
    // resulting state version AFTER it's applied, so it can't equal the snapshot
    // it follows. This was a latent test-fixture bug: the pre-B1-dedup code applied
    // every incoming patch unconditionally, so it went unnoticed; the B1 fix (skip
    // patch.version <= #lastVersion) correctly treats version:1 as already-applied
    // and would otherwise silently drop this patch, breaking the read count below.
    const patch1 = makePatch(2, {
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "x" },
    })
    // second connection ends immediately (stream closes) → triggers reconnect
    const newMessages = [
      {
        id: "m_0",
        role: "assistant" as const,
        messageId: "p1",
        segments: [
          { id: "s_0", text: "x" },
          { id: "s_1", text: "y" },
        ],
      },
    ]
    const snapshot2 = makeSnapshot({
      version: 5,
      messages: newMessages,
      nextMessageSeq: 1,
      nextSegmentSeq: 2,
    })

    let call = 0
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (!url.includes("/events")) return Promise.resolve(jsonResponse({ ok: true }))
      call++
      if (call === 1) {
        return Promise.resolve(
          sseResponse([
            {
              event: "snapshot",
              data: JSON.stringify({
                ...snapshot1,
                messages: [{ id: "m_0", role: "assistant", messageId: "p1", segments: [] }],
              }),
            },
            { event: "patch", data: JSON.stringify(patch1) },
          ]),
        )
      }
      // reconnect: newer snapshot — stays open so the test doesn't trigger yet
      // another reconnect after this one settles.
      return Promise.resolve(
        sseResponse([{ event: "snapshot", data: JSON.stringify(snapshot2) }], { keepOpen: true }),
      )
    })

    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    // drain (slice remote-warm-reconnect C3 hydration): ה-snapshot של החיבור הראשון
    // נושא message אחד ⇒ reset הידרציה (v1), אחריו ה-append-segment (v2), ואז
    // ה-reset הסינתטי של ה-reconnect (v5).
    const results = await readNPatchArrays(view.patches, 3)

    expect(results[0]?.[0]).toMatchObject({ op: "reset", version: 1 }) // hydration
    expect(results[1]?.[0]).toMatchObject({ op: "append-segment", version: 2 })
    expect(results[2]?.[0]).toMatchObject({ op: "reset", version: 5 })
    expect(view.state.version).toBe(5)
    expect(view.lastReadMessageId).toBeNull()
    expect(view.lastReadSegmentIndex).toBe(0)
  })

  it("snapshot.version <= lastVersion after reconnect → skips (no reset patch)", async () => {
    const snapshot = makeSnapshot({ version: 3 })

    let call = 0
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (!url.includes("/events")) return Promise.resolve(jsonResponse({ ok: true }))
      call++
      if (call === 1) {
        return Promise.resolve(sseResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]))
      }
      if (call === 2) {
        // reconnect with same version — no new data
        return Promise.resolve(sseResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]))
      }
      // subsequent reconnect: emit a real patch so the test can observe progress
      const patch = makePatch(4, { op: "update-session", changes: { title: "after-reconnect" } })
      return Promise.resolve(
        sseResponse([
          { event: "snapshot", data: JSON.stringify(snapshot) },
          { event: "patch", data: JSON.stringify(patch) },
        ]),
      )
    })

    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    const results = await readNPatchArrays(view.patches, 1)

    // no synthetic reset patch was injected — only the real update-session patch
    expect(results[0]?.[0]).toMatchObject({ op: "update-session", version: 4 })
  })

  // ─── calev-heavy B1: dedup replayed patches by version ───

  it("B1: skips patches already reflected in the reconnect snapshot (ring-buffer replay dedup)", async () => {
    const addMsg: Patch = {
      version: 1,
      op: "add-message",
      message: { id: "m_0", role: "assistant", messageId: "p1", segments: [] },
    }
    const appendSeg1: Patch = {
      version: 2,
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "hello" },
    }
    const appendSeg2: Patch = {
      version: 3,
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_1", text: " world" },
    }
    const freshPatch = makePatch(4, { op: "update-session", changes: { title: "still fresh" } })

    // PatchesBroadcaster.subscribe() replays up to 64 buffered patches to every new
    // subscriber — the reconnect snapshot ALREADY reflects v1-v3, but the wire still
    // resends v1-v3 as patch frames too (this is what production actually does).
    const snapshotAfterReconnect = makeSnapshot({
      version: 3,
      messages: [
        {
          id: "m_0",
          role: "assistant",
          messageId: "p1",
          segments: [
            { id: "s_0", text: "hello" },
            { id: "s_1", text: " world" },
          ],
        },
      ],
      nextMessageSeq: 1,
      nextSegmentSeq: 2,
    })

    let call = 0
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (!url.includes("/events")) return Promise.resolve(jsonResponse({ ok: true }))
      call++
      if (call === 1) {
        // first connection: 3 genuinely-new patches, then the stream ends → reconnect
        return Promise.resolve(
          sseResponse([
            { event: "snapshot", data: JSON.stringify(makeSnapshot({ version: 0 })) },
            { event: "patch", data: JSON.stringify(addMsg) },
            { event: "patch", data: JSON.stringify(appendSeg1) },
            { event: "patch", data: JSON.stringify(appendSeg2) },
          ]),
        )
      }
      // reconnect: snapshot already reflects v1-v3, PLUS the ring-buffer replays
      // v1-v3 again as patch frames, THEN one genuinely-new patch (v4). Stays open
      // (keepOpen) so the test doesn't trigger yet another reconnect after v4.
      return Promise.resolve(
        sseResponse(
          [
            { event: "snapshot", data: JSON.stringify(snapshotAfterReconnect) },
            { event: "patch", data: JSON.stringify(addMsg) },
            { event: "patch", data: JSON.stringify(appendSeg1) },
            { event: "patch", data: JSON.stringify(appendSeg2) },
            { event: "patch", data: JSON.stringify(freshPatch) },
          ],
          { keepOpen: true },
        ),
      )
    })

    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    // 3 genuine patches from connection 1, then the 3 replayed duplicates must be
    // silently skipped — the 4th read must be the fresh v4 patch, not a repeat of v1.
    const results = await readNPatchArrays(view.patches, 4)

    expect(results).toHaveLength(4)
    expect(results[3]?.[0]).toMatchObject({ version: 4, op: "update-session" })
    // final state reflects each segment exactly once — not duplicated
    const msg = view.state.messages.find((m) => m.id === "m_0")
    expect(msg && msg.role !== "tool" ? msg.segments : []).toEqual([
      { id: "s_0", text: "hello" },
      { id: "s_1", text: " world" },
    ])
  })

  // ─── calev-heavy B2+M6: full state replacement + sessionId refresh ───

  it("B2: reconnect carries pending permission through (full state replace, not partial reset)", async () => {
    const snapshot1 = makeSnapshot({ version: 1 })
    const snapshotWithPending = makeSnapshot({
      version: 5,
      pending: { permission: { requestId: 9, params: {} as never }, elicitation: null },
      title: "Restored Title",
    })

    let call = 0
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (!url.includes("/events")) return Promise.resolve(jsonResponse({ ok: true }))
      call++
      if (call === 1) {
        return Promise.resolve(
          sseResponse([{ event: "snapshot", data: JSON.stringify(snapshot1) }]),
        )
      }
      // reconnect: newer snapshot carries a pending permission that arose while
      // disconnected — a partial `reset` patch (messages-only) would drop it.
      return Promise.resolve(
        sseResponse([{ event: "snapshot", data: JSON.stringify(snapshotWithPending) }], {
          keepOpen: true,
        }),
      )
    })

    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()
    await readNPatchArrays(view.patches, 1) // the synthetic reset patch from reconnect

    expect(view.state.pending.permission).toMatchObject({ requestId: 9 })
    expect(view.state.title).toBe("Restored Title")
  })

  it("M6: refreshes sessionId and accepts a lower version after a BE restart (new session)", async () => {
    const snapshotBeforeRestart = makeSnapshot({ sessionId: "sess-100-1", version: 50 })
    const snapshotAfterRestart = makeSnapshot({ sessionId: "sess-200-1", version: 2 })

    let call = 0
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (!url.includes("/events")) return Promise.resolve(jsonResponse({ ok: true }))
      call++
      if (call === 1) {
        return Promise.resolve(
          sseResponse([{ event: "snapshot", data: JSON.stringify(snapshotBeforeRestart) }]),
        )
      }
      // BE restarted: brand-new host, brand-new (lower) version counter, new sessionId.
      return Promise.resolve(
        sseResponse([{ event: "snapshot", data: JSON.stringify(snapshotAfterRestart) }], {
          keepOpen: true,
        }),
      )
    })

    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()
    await readNPatchArrays(view.patches, 1) // the synthetic reset patch from reconnect

    expect(view.state.sessionId).toBe("sess-200-1")
    expect(view.state.version).toBe(2)
  })
})

// ── C4: factory ────────────────────────────────────────────────────────────────

describe("createRemoteSessionView()", () => {
  it("returns a RemoteSessionView instance that connects and works end-to-end", async () => {
    const mockFetch = makeMockFetch({})
    const view = createRemoteSessionView("agent-1", "http://be.local", {
      _fetch: mockFetch,
      _sleep: noSleep,
    })
    activeViews.push(view)

    expect(view).toBeInstanceOf(RemoteSessionView)
    await view.connect()
    expect(view.state.sessionId).toBe("sess-1")
  })
})
