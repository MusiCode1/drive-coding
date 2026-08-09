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
 *   - respond(): גוזר kind מ-state.pending (permission עדיפות)
 *   - session management methods (newSession/loadSession/listSessions/deleteSession): throw
 *   - close(): סוגר SSE reader
 *
 * C3 tests:
 *   - water-mark advances on append-segment patches
 *   - reconnect mid-turn: snapshot.version > lastVersion → reset patch + water-mark reset
 *   - reconnect: snapshot.version <= lastVersion → skip (no reset patch)
 */

import type { Patch, SessionState } from "@drive-coding/core/session"
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

function sseBody(frames: Array<{ event: string; data: string }>): ReadableStream<Uint8Array> {
  const text = frames.map((f) => `event: ${f.event}\ndata: ${f.data}\n\n`).join("")
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(text))
      ctrl.close()
    },
  })
}

function sseResponse(frames: Array<{ event: string; data: string }>): Response {
  return { ok: true, status: 200, body: sseBody(frames) } as unknown as Response
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
  onRpc?: (body: unknown) => void
  onReply?: (body: unknown) => void
}): (url: string, init?: RequestInit) => Promise<Response> {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/events")) {
      return sseResponse(
        opts.events ?? [{ event: "snapshot", data: JSON.stringify(makeSnapshot()) }],
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

  it("prompt() with PromptBlocks (non-string content) throws — BE only accepts string (avigail #7)", async () => {
    let called = false
    const mockFetch = makeMockFetch({ onRpc: () => (called = true) })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await expect(view.prompt([{ type: "text", text: "hi" }] as never)).rejects.toThrow(
      "not supported in remote mode",
    )
    expect(called).toBe(false)
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

  it("prefers permission when both pending share the same requestId", async () => {
    let captured: unknown
    const snapshot = makeSnapshot({
      pending: {
        permission: { requestId: 5, params: {} as never },
        elicitation: { requestId: 5, params: {} as never },
      },
    })
    const mockFetch = makeMockFetch({
      events: [{ event: "snapshot", data: JSON.stringify(snapshot) }],
      onReply: (b) => (captured = b),
    })
    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    await view.respond(5, {})

    expect(captured).toMatchObject({ kind: "permission", requestId: 5 })
  })
})

// ── session management methods (throw — backend manages sessions) ────────────

describe("RemoteSessionView — session management methods throw", () => {
  it("newSession() throws", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: makeMockFetch({}),
      _sleep: noSleep,
    })
    await expect(view.newSession()).rejects.toThrow("not supported in remote mode")
  })

  it("loadSession() throws", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: makeMockFetch({}),
      _sleep: noSleep,
    })
    await expect(view.loadSession("s-1")).rejects.toThrow("not supported in remote mode")
  })

  it("listSessions() throws", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: makeMockFetch({}),
      _sleep: noSleep,
    })
    await expect(view.listSessions()).rejects.toThrow("not supported in remote mode")
  })

  it("deleteSession() throws", async () => {
    const view = newView("agent-1", "http://be.local", {
      _fetch: makeMockFetch({}),
      _sleep: noSleep,
    })
    await expect(view.deleteSession("s-1")).rejects.toThrow("not supported in remote mode")
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
    const patch1 = makePatch(1, {
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
      // reconnect: newer snapshot
      return Promise.resolve(sseResponse([{ event: "snapshot", data: JSON.stringify(snapshot2) }]))
    })

    const view = newView("agent-1", "http://be.local", { _fetch: mockFetch, _sleep: noSleep })
    await view.connect()

    // drain: 1 append-segment patch, then 1 synthetic reset patch after reconnect
    const results = await readNPatchArrays(view.patches, 2)

    expect(results[1]?.[0]).toMatchObject({ op: "reset", version: 5 })
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
