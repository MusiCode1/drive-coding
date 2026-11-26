import {
  type ChannelResponse,
  createInitialSessionState,
  decodeWsClientMessage,
  encodeWsFrame,
  encodeWsServerResponse,
  snapshotFrame,
  updateFrame,
} from "@drive-coding/core/session"
import { describe, expect, it, vi } from "vitest"
import { type FakeSessionSocket, fakeSessionSockets } from "./__contract__/fake-session-socket"
import { PROMPT_DISPATCH_TIMEOUT_MS, type PromptDispatchOutcome } from "./prompt-dispatch"
import { RemoteSessionView } from "./remote-session-view"
import { PipeError, type RpcPipe, type SessionPipe } from "./wire/pipe"
import { createWsSessionPipe } from "./wire/ws-pipe"

const backendBaseUrl = "https://example.test"
const mismatch = {
  error: "Prompt session no longer matches the active session",
  code: "prompt_session_mismatch",
}
const body = {
  method: "session/prompt",
  params: { sessionId: "A", content: "hello", meta: undefined },
}

async function setup(identified = true) {
  const call = vi.fn<RpcPipe["call"]>()
  const pipe: SessionPipe = {
    frames: {
      async open() {
        throw new Error("This fixture attaches via loadSession")
      },
      describe: "test",
    },
    rpc: { call, label: () => "test" },
    history: { get: async () => ({ status: 404, body: undefined }) },
    close: vi.fn(),
  }
  const view = new RemoteSessionView("agent", pipe, {
    ...(identified && { targetBackendBaseUrl: backendBaseUrl }),
  })
  call.mockResolvedValueOnce({ status: 200, body: { sessionId: "A" } })
  await view.loadSession("A")
  call.mockClear()
  return { call, view }
}

describe("owned prompt RPC", () => {
  it("passes the captured session, ordered blocks and metadata to the raw RPC", async () => {
    const { call, view } = await setup()
    try {
      const content = [
        { type: "image" as const, mimeType: "image/png", data: "AA==" },
        { type: "text" as const, text: "inspect" },
        { type: "image" as const, mimeType: "image/png", data: "AQ==" },
      ]
      const meta = { recordingId: "" }
      call.mockResolvedValueOnce({ status: 202, body: undefined })
      await expect(view.promptTo("A", content, meta)).resolves.toEqual({ kind: "accepted" })
      expect(call).toHaveBeenCalledExactlyOnceWith(
        "rpc",
        { method: "session/prompt", params: { sessionId: "A", content, meta } },
        { timeoutMs: 30_000, statusOnlyOn: 202 },
      )
    } finally {
      await view.close()
    }
  })

  it("stops before the pipe if the captured target is stale or the view has closed", async () => {
    const { call, view } = await setup()
    try {
      call.mockResolvedValueOnce({ status: 200, body: { sessionId: "B" } })
      await view.loadSession("B")
      call.mockClear()
      await expect(view.promptTo("A", "hello")).resolves.toEqual({ kind: "not-started" })
      expect(call).not.toHaveBeenCalled()
    } finally {
      await view.close()
    }
    await expect(view.promptTo("B", "hello")).resolves.toEqual({ kind: "not-started" })
    expect(call).not.toHaveBeenCalled()
  })

  it("requires an owned target identity and preserves the legacy prompt path", async () => {
    const { call, view } = await setup(false)
    try {
      await expect(view.promptTo("A", "hello")).resolves.toEqual({ kind: "not-started" })
      expect(call).not.toHaveBeenCalled()
      call.mockResolvedValueOnce({ status: 202, body: { version: 3 } })
      await expect(view.prompt("hello")).resolves.toBeUndefined()
      expect(call).toHaveBeenCalledExactlyOnceWith("rpc", body)
    } finally {
      await view.close()
    }
  })

  const authMethods = [{ id: "sign-in", name: "Sign in" }]
  const cases: [string, ChannelResponse, PromptDispatchOutcome][] = [
    [
      "a structured target mismatch",
      { status: 409, body: mismatch },
      { kind: "rejected", retryable: true, reason: "session-mismatch", error: mismatch.error },
    ],
    [
      "scope denied with reason and hint",
      { status: 403, body: { error: "scope-denied", reason: "denied", hint: "Ask the user" } },
      { kind: "rejected", retryable: true, reason: "scope-denied", error: "scope-denied" },
    ],
    [
      "authentication required with guidance",
      { status: 401, body: { error: "Sign in", kind: "auth_required", authMethods } },
      { kind: "rejected", retryable: true, reason: "auth-required", error: "Sign in", authMethods },
    ],
    [
      "missing agent connection",
      { status: 404, body: { error: "Agent connection not found" } },
      {
        kind: "rejected",
        retryable: true,
        reason: "connection-not-found",
        error: "Agent connection not found",
      },
    ],
    [
      "invalid waitMs",
      { status: 400, body: { error: "invalid waitMs" } },
      { kind: "rejected", retryable: false, reason: "invalid-request", error: "invalid waitMs" },
    ],
    [
      "invalid JSON",
      { status: 400, body: { error: "invalid json" } },
      { kind: "rejected", retryable: false, reason: "invalid-request", error: "invalid json" },
    ],
    ["409 without JSON", { status: 409, body: undefined }, { kind: "unknown" }],
    [
      "409 with a non-string error",
      { status: 409, body: { ...mismatch, error: 1 } },
      { kind: "unknown" },
    ],
    [
      "a different conflict",
      { status: 409, body: { ...mismatch, code: "session_busy" } },
      { kind: "unknown" },
    ],
    [
      "scope error without a hint",
      { status: 403, body: { error: "scope-denied", reason: "denied" } },
      { kind: "unknown" },
    ],
    [
      "auth error without an array",
      { status: 401, body: { error: "Sign in", kind: "auth_required", authMethods: {} } },
      { kind: "unknown" },
    ],
    ["generic 404", { status: 404, body: { error: "Not Found" } }, { kind: "unknown" }],
    [
      "invalid params",
      { status: 400, body: { error: "content must be a string" } },
      { kind: "unknown" },
    ],
    ["unexpected 200", { status: 200, body: { ok: true } }, { kind: "unknown" }],
    ["upstream error", { status: 502, body: mismatch }, { kind: "unknown" }],
  ]
  it.each(cases)("classifies %s", async (_label, response, outcome) => {
    const { call, view } = await setup()
    try {
      call.mockResolvedValueOnce(response)
      await expect(view.promptTo("A", "hello")).resolves.toEqual(outcome)
    } finally {
      await view.close()
    }
  })

  it("does not use a typed connection failure as a correlated response", async () => {
    const { call, view } = await setup()
    try {
      call.mockRejectedValueOnce(new PipeError(409, mismatch, "Socket closed"))
      await expect(view.promptTo("A", "hello")).resolves.toEqual({ kind: "unknown" })
    } finally {
      await view.close()
    }
  })
})

async function openWsView() {
  const sockets = fakeSessionSockets()
  const pipe = createWsSessionPipe("ws://example.test/ws/session/agent", {
    _WebSocket: sockets.WebSocket,
  })
  const view = new RemoteSessionView("agent", pipe, {
    targetBackendBaseUrl: backendBaseUrl,
    _fetch: async () => new Response(null, { status: 404 }),
  })
  const connecting = view.connect()
  const socket = sockets.latest()
  socket.connect()
  socket.receive(encodeWsFrame(snapshotFrame(createInitialSessionState({ sessionId: "A" }))))
  await connecting
  return { view, socket }
}

function readPromptRequest(socket: FakeSessionSocket) {
  const request = decodeWsClientMessage(socket.sent.at(-1) ?? "")
  if (request?.kind !== "request") throw new Error("Expected an RPC request")
  expect(request.request.method).toBe("_drive/rpc")
  expect(request.request.params).toEqual({
    method: "session/prompt",
    params: { sessionId: "A", content: "hello" },
  })
  return request.request.id
}

describe("owned prompt evidence on the WebSocket", () => {
  it.each([true, false])("times out a dropped ACK with delivered=%s", async (delivered) => {
    vi.useFakeTimers()
    let opened: Awaited<ReturnType<typeof openWsView>> | undefined
    try {
      opened = await openWsView()
      const { view, socket } = opened
      const hostPrompt = vi.fn()
      const sendOnSocket = socket.send.bind(socket)
      vi.spyOn(socket, "send").mockImplementation((frame) => {
        sendOnSocket(frame)
        if (!delivered) return
        const message = decodeWsClientMessage(frame)
        if (message?.kind === "request" && message.request.method === "_drive/rpc") {
          hostPrompt(message.request.params)
        }
      })
      const settled = vi.fn()
      const attempt = view.promptTo("A", "hello").then(settled)
      const id = readPromptRequest(socket)
      socket.receive(encodeWsServerResponse(id + 1, { status: 202, body: { version: 1 } }))
      socket.receive(JSON.stringify({ jsonrpc: "2.0", id, result: { status: "202", body: {} } }))

      await vi.advanceTimersByTimeAsync(PROMPT_DISPATCH_TIMEOUT_MS - 1)
      expect(settled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toHaveBeenCalledExactlyOnceWith({ kind: "unknown" })
      await attempt
      if (delivered) {
        expect(hostPrompt).toHaveBeenCalledExactlyOnceWith({
          method: "session/prompt",
          params: { sessionId: "A", content: "hello" },
        })
      } else {
        expect(hostPrompt).not.toHaveBeenCalled()
      }
      expect(socket.readyState).toBe(1)
    } finally {
      await opened?.view.close()
      vi.useRealTimers()
    }
  })

  it.each([
    ["a structured mismatch", mismatch, { kind: "rejected", reason: "session-mismatch" }],
    ["a malformed mismatch", { code: mismatch.code }, { kind: "unknown" }],
  ] as const)("classifies %s in a correlated 409", async (_label, resultBody, expected) => {
    const { view, socket } = await openWsView()
    try {
      const attempt = view.promptTo("A", "hello")
      const id = readPromptRequest(socket)
      socket.receive(encodeWsServerResponse(id, { status: 409, body: resultBody }))
      await expect(attempt).resolves.toMatchObject(expected)
      expect(socket.readyState).toBe(1)
    } finally {
      await view.close()
    }
  })

  it("treats a socket close after send as ambiguous even with a conflict close code", async () => {
    const { view, socket } = await openWsView()
    try {
      const attempt = view.promptTo("A", "hello")
      readPromptRequest(socket)
      socket.close(4409)
      await expect(attempt).resolves.toEqual({ kind: "unknown" })
    } finally {
      await view.close()
    }
  })

  it.each(["before", "after"])("keeps a turn error %s a correlated 202 separate", async (order) => {
    const { view, socket } = await openWsView()
    try {
      const settled = vi.fn()
      const attempt = view.promptTo("A", "hello").then(settled)
      const id = readPromptRequest(socket)
      const changes = { lastTurnError: { message: "Turn failed", at: 1 } }
      const version = view.state.version + 1
      const turnError = updateFrame(
        { ...view.state, ...changes, version },
        { op: "update-session", changes, version },
      )
      if (!turnError) throw new Error("Expected a turn error frame")

      if (order === "before") {
        socket.receive(encodeWsFrame(turnError))
        await vi.waitFor(() => expect(view.state.lastTurnError).toEqual(changes.lastTurnError))
        expect(settled).not.toHaveBeenCalled()
      }
      socket.receive(encodeWsServerResponse(id, { status: 202, body: { version } }))
      await attempt
      expect(settled).toHaveBeenCalledExactlyOnceWith({ kind: "accepted" })
      if (order === "after") socket.receive(encodeWsFrame(turnError))
      await vi.waitFor(() => expect(view.state.lastTurnError).toEqual(changes.lastTurnError))
    } finally {
      await view.close()
    }
  })
})
