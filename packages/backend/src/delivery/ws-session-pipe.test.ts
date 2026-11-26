import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"
import {
  type ChannelFrame,
  createInitialSessionState,
  decodeWsServerMessage,
  encodeWsClientRequest,
  encodeWsControl,
  type Patch,
  WS_REPLY_METHOD,
  WS_RPC_METHOD,
} from "@drive-coding/core/session"
import { expect, it, vi } from "vitest"
import type { WebSocket } from "ws"
import { createConnectionRegistry } from "../acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import { createPatchesBroadcaster } from "../session-host/patches-broadcaster.js"
import type { AgentSessionRegistry, HostResult } from "../session-host/registry.js"
import type { ExtendedSessionHost } from "../session-host/session-host.js"
import { createSessionWsHandler } from "./ws-session-pipe.js"

const { failSnapshot } = vi.hoisted(() => ({ failSnapshot: vi.fn() }))

vi.mock("../acp/open-connection.js", () => ({
  openProviderConnection: vi.fn(async () => ({
    capabilities: {},
    onFrame: () => () => {},
    onCrash: () => () => {},
    close: async () => {},
  })),
}))

vi.mock("../session-host/channel/viewer-stream.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-host/channel/viewer-stream.js")>()
  return {
    ...original,
    openViewer: (...[deps, input]: Parameters<typeof original.openViewer>) =>
      original.openViewer(
        {
          ...deps,
          ...(failSnapshot.getMockImplementation() ? { _snapshotFrame: failSnapshot } : {}),
        },
        input,
      ),
  }
})

class Socket extends EventEmitter {
  readonly OPEN = 1
  readyState = this.OPEN
  messages: ReturnType<typeof decodeWsServerMessage>[] = []
  sendError?: Error
  send = vi.fn((data: string, cb: (err?: Error) => void) => {
    if (!this.sendError) this.messages.push(decodeWsServerMessage(data))
    cb(this.sendError)
  })
  close = vi.fn((_code?: number) => {
    this.readyState = 3
    this.emit("close")
  })
  terminate = vi.fn(() => this.close())

  get frames(): ChannelFrame[] {
    return this.messages.flatMap((message) => (message?.kind === "frame" ? [message.frame] : []))
  }

  request(id: number, method: typeof WS_RPC_METHOD | typeof WS_REPLY_METHOD, params: unknown) {
    this.receive(encodeWsClientRequest({ jsonrpc: "2.0", id, method, params }))
  }

  receive(data: string) {
    this.emit("message", Buffer.from(data))
  }
}

async function setup(opts: { missing?: boolean; delayed?: boolean; socketTtl?: number } = {}) {
  const connectionRegistry = createConnectionRegistry()
  if (!opts.missing) await connectionRegistry.connect("agent", "opencode", { cwd: process.cwd() })
  const source = new TransformStream<Patch>()
  const writer = source.writable.getWriter()
  const broadcaster = createPatchesBroadcaster(source.readable)
  const unsubscribe = vi.spyOn(broadcaster, "unsubscribe")
  const host = {
    state: createInitialSessionState({ sessionId: "session" }),
    prompt: vi.fn(async () => {}),
    isScopeRequest: vi.fn(() => false),
    respondPermission: vi.fn(),
    setMode: vi.fn(async () => {}),
  }
  const result: HostResult = opts.missing
    ? { ok: false, reason: "not-found" }
    : { ok: true, entry: { host: host as unknown as ExtendedSessionHost, broadcaster } }
  let release = () => {}
  const ready = new Promise<HostResult>((resolve) => {
    release = () => resolve(result)
  })
  const getOrCreateHost = vi.fn(async () => (opts.delayed ? ready : result))
  const agentSessionRegistry = {
    getOrCreateHost,
    getEpoch: connectionRegistry.getEpoch,
    getHost: () => host,
  } as unknown as AgentSessionRegistry
  const handler = createSessionWsHandler({
    agentSessionRegistry,
    connectionRegistry,
    agentRegistry: createInMemoryAgentRegistry(),
    _staleMs: opts.socketTtl,
    _sweepMs: opts.socketTtl,
  })
  function start(ws: Socket, query = "?connectionId=first") {
    return handler.onConnect(
      ws as unknown as WebSocket,
      { url: `/ws/session/agent${query}`, headers: {} } as IncomingMessage,
    )
  }
  return {
    start,
    host,
    getOrCreateHost,
    unsubscribe,
    connectionRegistry,
    writer,
    release,
    async stop() {
      handler.stop()
      broadcaster.close()
      await writer.close()
      await connectionRegistry.close("agent")
    },
  }
}

const promptBody = {
  method: "session/prompt",
  params: { sessionId: "session", content: "Hi" },
}

it("sends a missing agent error and closes 4404", async () => {
  const h = await setup({ missing: true })
  try {
    const socket = new Socket()
    await h.start(socket)
    expect(socket.frames).toEqual([
      { event: "error", data: JSON.stringify({ error: "Agent connection not found" }) },
    ])
    expect(socket.close).toHaveBeenCalledWith(4404)
  } finally {
    await h.stop()
  }
})

it("rejects stale epoch before looking up the host", async () => {
  const h = await setup()
  try {
    h.connectionRegistry.addConnection("agent", "existing", "http")
    const socket = new Socket()
    await h.start(socket, "?epoch=0")
    expect(h.getOrCreateHost).not.toHaveBeenCalled()
    expect(socket.close).toHaveBeenCalledWith(4409)
  } finally {
    await h.stop()
  }
})

it("opens with a snapshot, dispatches RPC and reply, and detaches", async () => {
  const h = await setup()
  const socket = new Socket()
  const done = h.start(socket)
  try {
    await vi.waitFor(() => expect(socket.frames[0]?.event).toBe("snapshot"))
    socket.request(1, WS_RPC_METHOD, promptBody)
    socket.request(2, WS_REPLY_METHOD, {
      kind: "permission",
      requestId: 5,
      result: { outcome: { outcome: "cancelled" } },
    })
    await vi.waitFor(() => {
      expect(socket.messages).toContainEqual({
        kind: "response",
        response: { jsonrpc: "2.0", id: 1, result: { status: 202, body: { version: 0 } } },
      })
      expect(socket.messages).toContainEqual({
        kind: "response",
        response: { jsonrpc: "2.0", id: 2, result: { status: 200, body: { ok: true } } },
      })
    })
    expect(h.host.prompt).toHaveBeenCalledOnce()
    expect(h.host.respondPermission).toHaveBeenCalledOnce()
    socket.receive(encodeWsControl("$/detach"))
    await done
    expect(h.connectionRegistry.listViewerRows("agent")).toEqual([])
    expect(socket.close).toHaveBeenCalledWith(1000)
  } finally {
    socket.close()
    await h.stop()
  }
})

it("answers a request sent immediately, before the viewer receives a snapshot", async () => {
  const h = await setup({ delayed: true })
  const socket = new Socket()
  const done = h.start(socket)
  try {
    // The invalid waitMs is rejected without looking up the host.
    socket.request(1, WS_RPC_METHOD, { ...promptBody, waitMs: -1 })
    await vi.waitFor(() =>
      expect(socket.messages).toEqual([
        {
          kind: "response",
          response: {
            jsonrpc: "2.0",
            id: 1,
            result: { status: 400, body: { error: "invalid waitMs" } },
          },
        },
      ]),
    )
  } finally {
    socket.close()
    h.release()
    await done
    expect(h.connectionRegistry.listViewerRows("agent")).toEqual([])
    await h.stop()
  }
})

it.each([undefined, 0, 50])("returns a correlated prompt conflict with waitMs %s", async (waitMs) => {
  const h = await setup()
  const socket = new Socket()
  const done = h.start(socket)
  try {
    await vi.waitFor(() => expect(socket.frames[0]?.event).toBe("snapshot"))
    const switched = { ...h.host.state, sessionId: "other-session" }
    h.host.state = switched
    socket.request(1, WS_RPC_METHOD, { ...promptBody, waitMs })
    await vi.waitFor(() =>
      expect(socket.messages).toContainEqual({
        kind: "response",
        response: {
          jsonrpc: "2.0",
          id: 1,
          result: {
            status: 409,
            body: {
              error: "Prompt session no longer matches the active session",
              code: "prompt_session_mismatch",
            },
          },
        },
      }),
    )
    expect(h.host.prompt).not.toHaveBeenCalled()
    expect(h.host.state).toBe(switched)
    expect(socket.frames.map((frame) => frame.event)).toEqual(["snapshot"])
    expect(socket.close).not.toHaveBeenCalled()

    socket.request(2, WS_RPC_METHOD, {
      method: "prompt",
      params: { ...promptBody.params, sessionId: "other-session" },
    })
    await vi.waitFor(() =>
      expect(socket.messages).toContainEqual({
        kind: "response",
        response: { jsonrpc: "2.0", id: 2, result: { status: 202, body: { version: 0 } } },
      }),
    )
    expect(h.host.prompt).toHaveBeenCalledExactlyOnceWith("other-session", "Hi", undefined)
  } finally {
    socket.close()
    await done
    await h.stop()
  }
})

it.each(["detach", "close", "error"])("cancels an opening viewer on %s", async (event) => {
  const h = await setup({ delayed: true })
  const socket = new Socket()
  const done = h.start(socket)
  try {
    if (event === "detach") socket.receive(encodeWsControl("$/detach"))
    else if (event === "error") socket.emit("error", new Error("socket failed"))
    else socket.close()
    h.release()
    await done
    expect(socket.frames).toEqual([])
    expect(h.connectionRegistry.listViewerRows("agent")).toEqual([])
  } finally {
    await h.stop()
  }
})

it("answers ping without refreshing the registry row and unsubscribes on close", async () => {
  const h = await setup()
  const socket = new Socket()
  const done = h.start(socket)
  try {
    await vi.waitFor(() => expect(socket.frames[0]?.event).toBe("snapshot"))
    const [before] = h.connectionRegistry.listViewerRows("agent")
    const touch = vi.spyOn(h.connectionRegistry, "touchConnection")
    socket.receive(encodeWsControl("$/ping"))
    await vi.waitFor(() => expect(socket.messages).toContainEqual({ kind: "pong" }))
    expect(h.connectionRegistry.listViewerRows("agent")).toEqual([before])
    expect(touch).not.toHaveBeenCalled()
    socket.close()
    await done
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  } finally {
    socket.close()
    await h.stop()
  }
})

it("turns a throwing dispatch into a 500 reply", async () => {
  const h = await setup()
  const socket = new Socket()
  const done = h.start(socket)
  try {
    await vi.waitFor(() => expect(socket.frames[0]?.event).toBe("snapshot"))
    h.host.setMode.mockImplementation(() => {
      throw new Error("setMode failed")
    })
    socket.request(1, WS_RPC_METHOD, {
      method: "session/set_mode",
      params: { sessionId: "session", modeId: "mode" },
    })
    await vi.waitFor(() =>
      expect(socket.messages).toContainEqual({
        kind: "response",
        response: {
          jsonrpc: "2.0",
          id: 1,
          result: { status: 500, body: { error: "setMode failed" } },
        },
      }),
    )
  } finally {
    socket.close()
    await done
    await h.stop()
  }
})

it("closes 4500 after a snapshot creation failure", async () => {
  const h = await setup()
  try {
    failSnapshot.mockImplementation(() => {
      throw new Error("snapshot failed")
    })
    const socket = new Socket()
    await h.start(socket)
    expect(socket.close).toHaveBeenCalledWith(4500)
  } finally {
    failSnapshot.mockReset()
    await h.stop()
  }
})

it("cancels when ws.send reports an error", async () => {
  const h = await setup()
  try {
    const socket = new Socket()
    socket.sendError = new Error("failed to send")
    await h.start(socket)
    expect(socket.close).toHaveBeenCalledWith(1000)
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  } finally {
    await h.stop()
  }
})

it("terminates a stale socket after its last ping expires", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
  const h = await setup({ socketTtl: 100 })
  const socket = new Socket()
  const done = h.start(socket)
  try {
    await vi.advanceTimersByTimeAsync(90)
    socket.receive(encodeWsControl("$/ping"))
    await vi.advanceTimersByTimeAsync(10)
    expect(socket.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(socket.terminate).toHaveBeenCalledOnce()
    await done
    expect(h.connectionRegistry.listViewerRows("agent")).toEqual([])
  } finally {
    socket.close()
    await h.stop()
    vi.useRealTimers()
  }
})

it("shares updates and an epoch across two sockets", async () => {
  const h = await setup()
  const a = new Socket()
  const b = new Socket()
  const aDone = h.start(a)
  let bDone: Promise<void> | undefined
  try {
    await vi.waitFor(() => expect(a.frames[0]?.event).toBe("snapshot"))
    expect(h.connectionRegistry.getEpoch("agent")).toBe(1)
    bDone = h.start(b, "?connectionId=second")
    await vi.waitFor(() => expect(b.frames[0]?.event).toBe("snapshot"))
    expect(h.connectionRegistry.getEpoch("agent")).toBe(1)
    expect(a.frames[0]).toEqual(b.frames[0])
    await h.writer.write({ op: "update-session", version: 1, changes: { title: "Shared" } })
    await vi.waitFor(() => {
      expect(a.frames[1]?.event).toBe("update")
      expect(b.frames[1]).toEqual(a.frames[1])
    })
  } finally {
    a.close()
    b.close()
    await Promise.all([aDone, bDone])
    await h.stop()
  }
})
