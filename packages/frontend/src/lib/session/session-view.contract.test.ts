/**
 * session-view.contract.test.ts — מריץ את session-view-contract על HTTP/SSE ו-WebSocket.
 *
 * Testing: tdd (brief §C1)
 *
 * remote — RemoteSessionView עם fake SSE או WS. ⚠️ ה-harness מריץ `reduce`/`applyPendingRequest`/
 *          `clearPendingRequest`/`applyTurnEnd` מ-core (לא patches ידניים) — כדי שהתנהגות 3
 *          תבדוק את ה-view, לא את ה-harness. אותם פריימים מפוענחים ב-FrameReader.
 *
 * + טבלת-הסטייה (session management, PromptBlocks, RPC failure, respond id לא-מוכר).
 *
 * ─── slice view-switch C1 (TDD) ───
 */

import {
  applyPendingRequest,
  applyTurnEnd,
  type ChannelResponse,
  clearPendingRequest,
  closeCodeForStatus,
  createInitialSessionState,
  decodeWsClientMessage,
  encodeWsControl,
  encodeWsFrame,
  encodeWsServerResponse,
  type Patch,
  type PendingKind,
  RPC_METHODS,
  reduce,
  type SessionState,
  type SseFrame,
  serializeFrame,
  snapshotFrame,
  type ToolOutput,
  type ToolOutputRules,
  updateFrame,
} from "@drive-coding/core/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "./__contract__/fake-session-socket"
import {
  type ContractHarness,
  describeSessionViewContract,
  PatchBuffer,
} from "./__contract__/session-view-contract.js"
import { createRemoteView } from "./create-session-view.js"
import type { RemoteSessionView } from "./remote-session-view.js"
import type { SessionTransport } from "./session-transport"
import type { RpcKind } from "./wire/pipe"

function makeLiveSSEBody(): {
  body: ReadableStream<Uint8Array>
  pushRaw: (frame: SseFrame) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      ctrl = c
    },
  })
  return {
    body,
    close: () => ctrl.close(),
    // ⚠️ המסגור נעשה ע"י הקורא, לא כאן. ה-harness הוא היחיד שמחזיק את
    // ה-shadowState — וה-state נדרש כדי למפות patch ל-`session/update`
    // (‏`append-segment` נושא `targetId` בלבד, והסוג נגזר מה-role של היעד).
    pushRaw: (frame) => {
      ctrl.enqueue(encoder.encode(serializeFrame(frame)))
    },
  }
}

type HandleRequest = (kind: RpcKind, body: unknown) => ChannelResponse
type FrameTransform = (frame: SseFrame) => SseFrame

async function connectRemoteHarness(
  transport: SessionTransport,
  snapshot: SessionState,
  handleRequest: HandleRequest,
  transformWsFrame: FrameTransform = (frame) => frame,
) {
  const initialFrame = snapshotFrame(snapshot)
  const base = { agentId: "agent-contract", baseUrl: "http://be.local", transport }
  if (transport === "ws") {
    const sockets = fakeSessionSockets()
    const connected = createRemoteView({ ...base, _WebSocket: sockets.WebSocket })
    const socket = sockets.latest()
    const send = socket.send.bind(socket)
    vi.spyOn(socket, "send").mockImplementation((data) => {
      send(data)
      const message = decodeWsClientMessage(data)
      if (!message) throw new Error("Malformed WS client message")
      if (message.kind === "ping") socket.receive(encodeWsControl("$/pong"))
      if (message.kind !== "request") return
      const { id, method, params } = message.request
      const reply = handleRequest(method === "_drive/rpc" ? "rpc" : "reply", params)
      socket.receive(encodeWsServerResponse(id, reply))
    })
    const pushRaw = (frame: SseFrame) => socket.receive(encodeWsFrame(transformWsFrame(frame)))
    socket.connect()
    pushRaw(initialFrame)
    return { view: await connected, pushRaw }
  }

  const sse = makeLiveSSEBody()
  const view = await createRemoteView({
    ...base,
    async _fetch(url, init) {
      if (url.endsWith("/events")) {
        sse.pushRaw(initialFrame)
        init?.signal?.addEventListener("abort", sse.close, { once: true })
        return new Response(sse.body)
      }
      const raw: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      if (!url.endsWith("/rpc") && !url.endsWith("/reply")) throw new Error("Unexpected RPC URL")
      const response = handleRequest(url.endsWith("/rpc") ? "rpc" : "reply", raw)
      return Response.json(response.body, { status: response.status })
    },
  })
  return { view, pushRaw: sse.pushRaw }
}

async function createRemoteHarness(transport: SessionTransport): Promise<ContractHarness> {
  const outboundLog: Array<{ method: string; params: unknown }> = []
  // The fixture folds the same updates as the host so each frame carries the right version.
  let shadowState = createInitialSessionState({ sessionId: "sess-contract" })
  let nextRequestId = 0
  const { view, pushRaw } = await connectRemoteHarness(transport, shadowState, (kind, body) => {
    if (kind === "reply") {
      outboundLog.push({ method: "reply", params: body })
      return { status: 200, body: { ok: true } }
    }
    outboundLog.push(body as { method: string; params: unknown })
    return { status: 202, body: { version: shadowState.version } }
  })

  const pb = new PatchBuffer(view.patches)

  /** דוחף patches (frame-per-patch — כמו production) וממתין שיוחלו, בלי לצרוך מה-buffer. */
  async function pushAndWait(patches: Patch[]): Promise<void> {
    if (patches.length === 0) return
    const target = pb.totalPushed + patches.length
    // slice acp-wire-session-update: כל patch נפלט כפריים `session/update`
    // דרך **אותו** `updateFrame` שה-BE משתמש בו — לא דרך העתק של הפורמט.
    for (const p of patches) {
      const frame = updateFrame(shadowState, p)
      if (frame !== null) pushRaw(frame)
    }
    await pb.waitForTotalAtLeast(target)
  }

  return {
    view,
    nextPatches: (n) => pb.nextPatches(n),
    async emitUpdate(update) {
      // ⚠️ חובה: reduce של core — לא patches ידניים (brief: אחרת התנהגות 3 בודקת את ה-harness).
      const { state, patches } = reduce(shadowState, update as Record<string, unknown>)
      shadowState = state
      await pushAndWait(patches)
    },
    async emitPermission(params) {
      const requestId = nextRequestId++
      const { state, patches } = applyPendingRequest(shadowState, {
        kind: "permission",
        value: { requestId, params: params as never },
      })
      shadowState = state
      await pushAndWait(patches)
      return requestId
    },
    async settle(effect) {
      if (effect === "turn-idle") {
        const { state, patches } = applyTurnEnd(shadowState)
        shadowState = state
        await pushAndWait(patches)
        return
      }
      // pending-cleared: נקה את מה שנשאר pending (permission/elicitation) — נגזר משדה-המקור.
      const kind: PendingKind | null = shadowState.pending.permission
        ? "permission"
        : shadowState.pending.elicitation
          ? "elicitation"
          : null
      if (!kind) return
      const current = shadowState.pending[kind]
      if (!current) return
      const { state, patches } = clearPendingRequest(shadowState, kind, current.requestId)
      shadowState = state
      await pushAndWait(patches)
    },
    outbound: () => outboundLog.filter((o) => o.method !== "reply"),
    async dispose() {
      await pb.dispose()
      await view.close().catch(() => {})
    },
  }
}

// ── shared contract ──────────────────────────────────────────────────────────

describeSessionViewContract("remote-http", () => createRemoteHarness("http"))
describeSessionViewContract("remote-ws", () => createRemoteHarness("ws"))

const terminalRules: ToolOutputRules = {
  fields: {
    text: [{ from: "meta", key: "terminal_output_delta", path: ["data"] }],
    exitCode: [{ from: "meta", key: "terminal_exit", path: ["exit_code"] }],
  },
  metaKeys: {
    terminal_info: "replace",
    terminal_output_delta: "append",
    terminal_exit: "replace",
  },
}

function stripWireMeta(frame: SseFrame): SseFrame {
  function strip({ _meta, ...update }: Record<string, unknown>) {
    return update
  }
  if (frame.event === "snapshot") {
    const snapshot = JSON.parse(frame.data) as { updates: Record<string, unknown>[] }
    return { ...frame, data: JSON.stringify({ ...snapshot, updates: snapshot.updates.map(strip) }) }
  }
  const batch = JSON.parse(frame.data) as {
    params: { update: Record<string, unknown> }
  }[]
  return {
    ...frame,
    data: JSON.stringify(
      batch.map((entry) => ({
        ...entry,
        params: { ...entry.params, update: strip(entry.params.update) },
      })),
    ),
  }
}

function firstToolOutput(state: SessionState): ToolOutput | undefined {
  const message = state.messages[0]
  return message?.role === "tool" ? message.toolCall.output : undefined
}

async function readToolOutput(transport: SessionTransport, transformWsFrame?: FrameTransform) {
  const toolCallId = "exec-fixture"
  const update = { sessionUpdate: "tool_call_update", toolCallId }
  const inputs = [
    { sessionUpdate: "tool_call", toolCallId, kind: "execute", _meta: { terminal_info: {} } },
    { ...update, _meta: { terminal_output_delta: { data: "one\n" } } },
    { ...update, _meta: { terminal_output_delta: { data: "two\n" } } },
    { ...update, status: "failed", _meta: { terminal_exit: { exit_code: 3 } } },
  ]

  let state = createInitialSessionState({ sessionId: "s1" })
  const ack: HandleRequest = () => ({ status: 202, body: {} })
  const { view, pushRaw } = await connectRemoteHarness(transport, state, ack, transformWsFrame)
  const patches = new PatchBuffer(view.patches)
  let frameCount = 0
  let live: ToolOutput | undefined
  try {
    for (const input of inputs) {
      const next = reduce(state, input, { toolOutput: terminalRules })
      state = next.state
      for (const patch of next.patches) {
        const frame = updateFrame(state, patch)
        if (!frame) continue
        pushRaw(frame)
        frameCount++
      }
    }
    await patches.waitForTotalAtLeast(frameCount)
    live = firstToolOutput(view.state)
  } finally {
    await patches.dispose()
    await view.close()
  }

  const late = await connectRemoteHarness(transport, state, ack, transformWsFrame)
  try {
    return { live, snapshot: firstToolOutput(late.view.state) }
  } finally {
    await late.view.close()
  }
}

describe("remote tool output", () => {
  const output = { text: "one\ntwo\n", exitCode: 3 }

  it("keeps canonical output equal across both transports and delivery modes", async () => {
    const sse = await readToolOutput("http")
    const ws = await readToolOutput("ws")
    expect(sse).toEqual({ live: output, snapshot: output })
    expect(ws).toEqual(sse)
  })

  it("detects a WS pipe that strips canonical metadata", async () => {
    const stripped = await readToolOutput("ws", stripWireMeta)
    expect(stripped).not.toEqual({ live: output, snapshot: output })
    expect(stripped).toEqual({ live: undefined, snapshot: undefined })
  })
})

describe("terminal session stream", () => {
  const crashReason = "The provider process exited"

  async function connectForTerminalTest(
    transport: SessionTransport,
    metadata: () => Response | Promise<Response>,
  ) {
    const state = createInitialSessionState({ sessionId: "s-crash" })
    const initial = snapshotFrame(state)
    const sse = makeLiveSSEBody()
    const sockets = fakeSessionSockets()
    let eventsRequests = 0
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/events")) {
        if (eventsRequests++ === 0) {
          sse.pushRaw(initial)
          return new Response(sse.body)
        }
        return Response.json({ error: "Agent connection not found" }, { status: 404 })
      }
      expect(url).toBe("http://be.local/api/agents/agent-crash")
      return metadata()
    })
    const connected = createRemoteView({
      agentId: "agent-crash",
      baseUrl: "http://be.local",
      transport,
      _WebSocket: sockets.WebSocket,
      _fetch: fetcher,
    })
    if (transport === "ws") {
      sockets.latest().connect()
      sockets.latest().receive(encodeWsFrame(initial))
    }
    const view = await connected
    return {
      view,
      metadataRequests: () => fetcher.mock.calls.filter(([url]) => !url.endsWith("/events")).length,
      async endAsGone() {
        if (transport === "ws") sockets.latest().close()
        else sse.close()
        await vi.advanceTimersByTimeAsync(1000)
        if (transport === "ws") sockets.latest().close(closeCodeForStatus(404))
        await vi.advanceTimersByTimeAsync(0)
      },
    }
  }

  it.each(["http", "ws"] as const)(
    "delivers the crash reason exactly once via %s",
    async (transport) => {
      vi.useFakeTimers()
      const host = await connectForTerminalTest(transport, () =>
        Response.json({ agent: { status: "crashed", crashReason } }),
      )
      const reader = host.view.patches.getReader()
      try {
        await host.endAsGone()
        expect(host.metadataRequests()).toBe(1)
        await expect(reader.read()).resolves.toMatchObject({
          value: { terminalError: crashReason },
        })
        await vi.advanceTimersByTimeAsync(30_000)
        expect(host.metadataRequests()).toBe(1)
      } finally {
        reader.releaseLock()
        await host.view.close()
        vi.useRealTimers()
      }
    },
  )

  const missingReason = {
    "network failure": () => Promise.reject(new Error("offline")),
    "404 response": () => new Response(null, { status: 404 }),
    "invalid JSON": () => new Response("{"),
    "missing field": () => Response.json({ agent: { status: "ready" } }),
    "invalid field": () => Response.json({ agent: { crashReason: 1 } }),
  }

  it.each(Object.entries(missingReason))("ends quietly after %s", async (_name, response) => {
    vi.useFakeTimers()
    const host = await connectForTerminalTest("http", response)
    const reader = host.view.patches.getReader()
    const delivered = vi.fn()
    void reader.read().then(delivered)
    try {
      await host.endAsGone()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(host.metadataRequests()).toBe(1)
      expect(delivered).not.toHaveBeenCalled()
    } finally {
      await host.view.close()
      await reader.cancel()
      reader.releaseLock()
      vi.useRealTimers()
    }
  })

  it("discards a metadata result that arrives after closing the view", async () => {
    vi.useFakeTimers()
    let complete!: (response: Response) => void
    const metadata = new Promise<Response>((resolve) => {
      complete = resolve
    })
    const host = await connectForTerminalTest("http", () => metadata)
    const reader = host.view.patches.getReader()
    try {
      await host.endAsGone()
      expect(host.metadataRequests()).toBe(1)
      await host.view.close()
      complete(Response.json({ agent: { crashReason } }))
      await vi.advanceTimersByTimeAsync(0)
      await expect(reader.read()).resolves.toMatchObject({ done: true })
    } finally {
      reader.releaseLock()
      vi.useRealTimers()
    }
  })
})

// ── טבלת-הסטייה (brief §C1) ──────────────────────────────────────────────────

describe.each(["http", "ws"] as const)("SessionView deviation table — %s", (transport) => {
  async function connect(rpcStatus = 202): Promise<RemoteSessionView> {
    const snapshot = createInitialSessionState({ sessionId: "s-1" })
    const { view } = await connectRemoteHarness(transport, snapshot, (kind, body) => {
      if (kind === "reply") return { status: 200, body: { ok: true } }
      const { method, params } = body as { method?: string; params?: { sessionId?: string } }
      switch (method) {
        case RPC_METHODS.listSessions:
          return {
            status: 200,
            body: {
              sessions: [{ sessionId: "s-9", cwd: "/w", title: "Listed" }],
              sessionCapabilities: { delete: {} },
            },
          }
        case RPC_METHODS.loadSession:
          return { status: 200, body: { sessionId: params?.sessionId ?? "s", version: 2 } }
        case RPC_METHODS.newSession:
          return { status: 200, body: { sessionId: "s-brand-new", version: 3 } }
        case RPC_METHODS.deleteSession:
          return { status: 200, body: { ok: true } }
        default:
          return { status: rpcStatus, body: { version: 1 } }
      }
    })
    activeViews.push(view)
    return view
  }

  const activeViews: RemoteSessionView[] = []
  afterEach(async () => {
    for (const v of activeViews) await v.close().catch(() => {})
    activeViews.length = 0
  })

  it("newSession/loadSession/listSessions/deleteSession perform real RPCs", async () => {
    const view = await connect()

    await expect(view.newSession("/w")).resolves.toBeUndefined()
    expect(view.state.sessionId).toBe("s-brand-new")

    // loadSession — resolves and updates BOTH sessionId sources from the answer
    await expect(view.loadSession("s-new", "/w")).resolves.toBeUndefined()
    expect(view.state.sessionId).toBe("s-new")

    // listSessions — normalized sessions + capabilities captured (delete gating)
    await expect(view.listSessions()).resolves.toEqual([
      { sessionId: "s-9", cwd: "/w", title: "Listed", updatedAt: "" },
    ])
    expect(view.supportsSessionDelete).toBe(true)

    // deleteSession — resolves on {ok:true}
    await expect(view.deleteSession("s-9")).resolves.toBeUndefined()
  })

  it("prompt(PromptBlocks) passes blocks to RPC without throwing (slice remote-images C1)", async () => {
    const view = await connect()

    await expect(view.prompt([{ type: "text", text: "hi" }] as never)).resolves.toBeUndefined()
  })

  it("rejects a failed RPC (5xx)", async () => {
    const view = await connect(500)

    await expect(view.prompt("hi")).rejects.toThrow("500")
  })

  it("respond() with an unknown id is a silent no-op", async () => {
    const view = await connect()

    await expect(view.respond(999, {})).resolves.toBeUndefined()
  })
})
