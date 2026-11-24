/**
 * remote-session-view.integration.test.svelte.ts — C4 integration test.
 *
 * Testing: integration (brief §C4)
 *
 * Verifies the full pipeline: RemoteSessionView (mock HTTP+SSE backend) → VM (AgentSession).
 * Mirrors agent-session.integration.test.svelte.ts (LocalSessionView) but drives the VM
 * through RemoteSessionView instead — same port, different transport (S2 D-decision:
 * the VM is agnostic to which SessionView implementation it's given).
 *
 * Known gap (avigail plan-gate r3, negative-space #8, not fixed here — out of scope for
 * this slice per מרדכי): AgentSession#syncFromViewState does not read `state.pending` or
 * `state.status`, so RemoteSessionView.respond() cannot be driven end-to-end through the
 * VM yet. respond()'s kind-derivation is already covered directly on RemoteSessionView
 * (remote-session-view.test.ts). Likewise the Speaker water-mark (C3) has no VM/Speaker
 * consumer yet (deferred to a follow-up slice) — not asserted here.
 *
 * ─── slice remote-session-view C4 (integration) ───
 */

import {
  createInitialSessionState,
  type Patch,
  RPC_METHODS,
  reduce,
  type SessionState,
} from "@drive-coding/core/session"
import { toWireText } from "@drive-coding/core/session/testing"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRemoteSessionView } from "$lib/session/create-session-view.js"
import type { RemoteSessionView } from "$lib/session/remote-session-view.js"
import { AgentSession } from "./agent-session.svelte.js"

// ── helpers (mirrors remote-session-view.test.ts's mock backend) ─────────────

const encoder = new TextEncoder()
const noSleep = (): Promise<void> => Promise.resolve()

function delay(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * sseBody — builds a mock SSE body.
 *
 * ⚠️ keepOpen defaults to true: a REAL SSE connection never closes on its own
 * (it stays open until the client disconnects or the server errors). If the mock
 * stream auto-closes, SSEReader's #runLoop treats that as "connection ended" and
 * immediately reconnects — with `_sleep: noSleep` + an instantly-resolving mock
 * fetch, that becomes an unbounded tight reconnect loop. Unlike the unit tests
 * (which close the view right after reading N patches, cutting the loop off
 * almost immediately), this integration test does a real `await delay(20)` — long
 * enough for that loop to run thousands of iterations and OOM the worker (this is
 * exactly the failure mode diagnosed and fixed in C1's sse-reader.test.ts).
 * Pass keepOpen:false only when a test deliberately wants to simulate a dropped
 * connection to exercise reconnect — and keep the FOLLOW-UP connection's stream
 * open, or the loop repeats.
 */
function sseBody(
  frames: Array<{ event: string; data: string }>,
  opts: { keepOpen?: boolean } = {},
): ReadableStream<Uint8Array> {
  const { keepOpen = true } = opts
  const text = toWireText(frames)
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(text))
      if (!keepOpen) ctrl.close()
      // else: leave open — matches a live SSE connection, reader.read() just
      // awaits further chunks (or the test's afterEach view.close() forever).
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
  return { ...createInitialSessionState({ sessionId: "int-sess-1" }), ...overrides }
}

function makeMockFetch(opts: {
  events?: Array<{ event: string; data: string }>
  onRpc?: (body: unknown) => void
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
      return jsonResponse({ ok: true }, 200)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

const activeViews: RemoteSessionView[] = []

function newConnectedView(
  events?: Array<{ event: string; data: string }>,
  onRpc?: (body: unknown) => void,
): { view: RemoteSessionView; mockFetch: ReturnType<typeof makeMockFetch> } {
  const mockFetch = makeMockFetch({ events, onRpc })
  const view = createRemoteSessionView("agent-1", "http://be.local", {
    _fetch: mockFetch,
    _sleep: noSleep,
  })
  activeViews.push(view)
  return { view, mockFetch }
}

afterEach(() => {
  for (const v of activeViews) v.close()
  activeViews.length = 0
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe("VM + RemoteSessionView integration (C4)", () => {
  it("shows the same message content after live delivery and snapshot hydration", async () => {
    let state = makeSnapshot()
    const events = [{ event: "snapshot", data: JSON.stringify(state) }]
    const entries = [
      ["user_message_chunk", "user-1", { type: "text", text: "before" }],
      ["user_message_chunk", "user-1", { type: "image", mimeType: "image/png", data: "YWJj" }],
      ["user_message_chunk", "user-1", { type: "text", text: " after" }],
      [
        "user_message_chunk",
        "user-1",
        { type: "resource_link", name: "Example", uri: "file:///example" },
      ],
      ["user_message_chunk", "user-2", { type: "text", text: "next" }],
      ["agent_message_chunk", "agent-1", { type: "image", mimeType: "image/png", data: "YWJj" }],
      ["agent_message_chunk", "agent-1", { type: "text", text: "reply" }],
      ["agent_message_chunk", "agent-1", { type: "audio", mimeType: "audio/wav", data: "YWJj" }],
    ] as const
    for (const [sessionUpdate, messageId, content] of entries) {
      const result = reduce(state, { sessionUpdate, messageId, content })
      state = result.state
      events.push(
        ...result.patches.map((patch) => ({ event: "patch", data: JSON.stringify(patch) })),
      )
    }

    const { view: live } = newConnectedView(events)
    const { view: restored } = newConnectedView([
      { event: "snapshot", data: JSON.stringify(state) },
    ])
    const liveVm = new AgentSession({ view: live })
    const restoredVm = new AgentSession({ view: restored })
    await Promise.all([live.connect(), restored.connect()])
    const visible = (vm: AgentSession) =>
      vm.bubbles.map((bubble) => ({
        messageId: bubble.messageId,
        text: bubble.segments.map((segment) => segment.text).join(""),
        attachments: bubble.kind === "user" ? (bubble.attachments ?? []) : [],
        placeholders: "contentPlaceholders" in bubble ? (bubble.contentPlaceholders ?? []) : [],
      }))
    await vi.waitFor(() =>
      expect(visible(liveVm)).toEqual([
        {
          messageId: "user-1",
          text: "before after",
          attachments: [{ mimeType: "image/png", dataBase64: "YWJj" }],
          placeholders: [{ kind: "resource_link", label: "Example", uri: "file:///example" }],
        },
        { messageId: "user-2", text: "next", attachments: [], placeholders: [] },
        {
          messageId: "agent-1",
          text: "reply",
          attachments: [],
          placeholders: [
            { kind: "image", mimeType: "image/png" },
            { kind: "audio", mimeType: "audio/wav" },
          ],
        },
      ]),
    )
    expect(visible(restoredVm)).toEqual(visible(liveVm))
  })

  it("connect() → VM syncs title/turnState from the initial snapshot's patches", async () => {
    const snapshot = makeSnapshot()
    const patch: Patch = { version: 1, op: "update-session", changes: { title: "Remote Title" } }
    const { view } = newConnectedView([
      { event: "snapshot", data: JSON.stringify(snapshot) },
      { event: "patch", data: JSON.stringify(patch) },
    ])

    const agent = new AgentSession({ view })
    await view.connect()
    await delay()

    expect(agent.sessionTitle).toBe("Remote Title")
  })

  it("add-message + append-segment patches → VM bubbles updated via applyPatchMutable", async () => {
    const snapshot = makeSnapshot()
    const addMsg: Patch = {
      version: 1,
      op: "add-message",
      message: { id: "m_0", role: "assistant", messageId: "prov-1", segments: [] },
    }
    const appendSeg: Patch = {
      version: 2,
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "hello from remote" },
    }
    const { view } = newConnectedView([
      { event: "snapshot", data: JSON.stringify(snapshot) },
      { event: "patch", data: JSON.stringify(addMsg) },
      { event: "patch", data: JSON.stringify(appendSeg) },
    ])

    const agent = new AgentSession({ view })
    await view.connect()
    await delay()

    expect(agent.bubbles.length).toBeGreaterThan(0)
    const bubble = agent.bubbles[agent.bubbles.length - 1]
    expect(bubble?.kind).toBe("message")
    if (bubble?.kind === "message") {
      expect(bubble.segments.some((s) => s.text === "hello from remote")).toBe(true)
    }
  })

  it("VM.sendPrompt-equivalent (view.prompt) → POST /rpc carries the remote sessionId", async () => {
    let captured: unknown
    const { view } = newConnectedView(undefined, (b) => (captured = b))
    const agent = new AgentSession({ view })
    await view.connect()
    await delay()

    await view.prompt("hi from VM")

    expect(captured).toMatchObject({
      method: RPC_METHODS.prompt,
      params: { sessionId: "int-sess-1", content: "hi from VM" },
    })
    // VM itself doesn't need to change for this — it's the same SessionView port
    // LocalSessionView already satisfies; this only proves RemoteSessionView carries
    // the server-assigned sessionId through, not a client-invented one.
    expect(agent).toBeDefined()
  })

  it("reconnect mid-turn: VM bubbles reflect the synthetic reset patch, not stale data", async () => {
    let call = 0
    const newMessages = [
      {
        id: "m_0",
        role: "assistant" as const,
        messageId: "prov-1",
        segments: [{ id: "s_0", text: "recovered" }],
      },
    ]
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (!url.includes("/events")) return Promise.resolve(jsonResponse({ ok: true }))
      call++
      if (call === 1) {
        // first connection ends (keepOpen:false) — this is what triggers the reconnect.
        return Promise.resolve(
          sseResponse([{ event: "snapshot", data: JSON.stringify(makeSnapshot({ version: 1 })) }], {
            keepOpen: false,
          }),
        )
      }
      // reconnect: newer snapshot with different messages — stays open (keepOpen default)
      // so the loop doesn't immediately "end" again and spin.
      return Promise.resolve(
        sseResponse([
          {
            event: "snapshot",
            data: JSON.stringify(
              makeSnapshot({
                version: 5,
                messages: newMessages,
                nextMessageSeq: 1,
                nextSegmentSeq: 1,
              }),
            ),
          },
        ]),
      )
    })
    const view = createRemoteSessionView("agent-1", "http://be.local", {
      _fetch: mockFetch,
      _sleep: noSleep,
    })
    activeViews.push(view)

    const agent = new AgentSession({ view })
    await view.connect()
    await delay()

    const bubble = agent.bubbles[agent.bubbles.length - 1]
    expect(bubble?.kind).toBe("message")
    if (bubble?.kind === "message") {
      expect(bubble.segments.some((s) => s.text === "recovered")).toBe(true)
    }
    expect(view.state.version).toBe(5)
  })
})
