import { once } from "node:events"
import {
  applyToolMessage,
  type ChannelFrame,
  type ChannelResponse,
  createInitialSessionState,
  decodeWsServerMessage,
  encodeWsClientRequest,
  reduce,
  type SessionState,
  type SnapshotPayload,
  STREAM_ALIVE_EVENT,
  TOOL_OUTPUT_META_KEY,
  type ToolOutputRules,
  WS_REPLY_METHOD,
  WS_RPC_METHOD,
  type WsClientRequest,
} from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { expect, it, vi } from "vitest"
import { WebSocket } from "ws"
import { createConnectionRegistry } from "../src/acp/connection-registry.js"
import { issueToken } from "../src/agent-scope.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import type { BootDeps } from "../src/boot/deps.js"
import { createWsStack } from "../src/boot/ws.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { registerEventsRoute } from "../src/session-host/http/events.js"
import { registerReplyRoute } from "../src/session-host/http/reply.js"
import { registerRpcRoute } from "../src/session-host/http/rpc.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"

const agentId = "parity-agent"
const sessionId = "parity-session"

const toolOutputRules = {
  fields: {
    text: [{ from: "meta", key: "terminal_output_delta", path: ["data"] }],
    exitCode: [{ from: "meta", key: "terminal_exit", path: ["exit_code"] }],
  },
  metaKeys: {
    terminal_info: "replace",
    terminal_output_delta: "append",
    terminal_exit: "replace",
  },
} satisfies ToolOutputRules

vi.mock("../src/acp/open-connection.js", () => ({
  openProviderConnection: async () => ({
    wire: { onLine: () => () => {}, write: () => true },
    capabilities: {},
    onCrash: () => () => {},
    onFrame: () => () => {},
    close: async () => {},
  }),
}))

async function setup(opts: { snapshotState?: SessionState; authError?: Error } = {}) {
  let callbacks: AcpClientCallbacks | undefined
  const client = {
    newSession: async () => ({ sessionId }),
    listSessions: async () => ({ sessions: [{ sessionId, cwd: process.cwd() }] }),
    setSessionMode: vi.fn(async () => {
      throw new Error("mode fixture failed")
    }),
    capabilities: {},
  } as unknown as AcpClient
  const connectionRegistry = createConnectionRegistry()
  await connectionRegistry.connect(agentId, "opencode", { cwd: process.cwd() })
  const agentSessionRegistry = createAgentSessionRegistry({
    connectionRegistry,
    _createHostFn: async (conn, hostOpts) => {
      if (opts.authError) throw opts.authError
      const host = await createSessionHostFromConnection(conn, {
        ...hostOpts,
        toolOutputRules,
        _createAcpClient: async (_transport, cbs) => {
          callbacks = cbs
          return client
        },
      })
      if (opts.snapshotState) Object.defineProperty(host, "state", { value: opts.snapshotState })
      return host
    },
  })
  const registry = createInMemoryAgentRegistry()
  const app = new Hono()
  registerEventsRoute(app, agentSessionRegistry, connectionRegistry)
  registerRpcRoute(app, agentSessionRegistry, registry)
  registerReplyRoute(app, agentSessionRegistry)

  const stack = createWsStack()
  stack.wireRoutes(app, { agentSessionRegistry, connectionRegistry, registry } as BootDeps)
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  stack.attachUpgradeHandler(server)
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing HTTP server address")
  const base = `http://127.0.0.1:${address.port}`
  const route = `${base}/api/agents/${agentId}`
  setSelfBaseUrlForTests(base)
  const end = new AbortController()
  const sockets: WebSocket[] = []

  function connectWs(headers?: Record<string, string>) {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/session/${agentId}`, { headers })
    sockets.push(ws)
    const frames: ChannelFrame[] = []
    const responses = new Map<number, ChannelResponse>()
    ws.on("message", (raw) => {
      const message = decodeWsServerMessage(raw.toString())
      if (message?.kind === "frame" && message.frame.event !== STREAM_ALIVE_EVENT)
        frames.push(message.frame)
      if (message?.kind === "response") responses.set(message.response.id, message.response.result)
    })
    const closed = once(ws, "close")
    void closed.catch(() => {})
    let nextId = 1
    return {
      frames,
      closed,
      async request(method: WsClientRequest["method"], params: unknown) {
        const id = nextId++
        ws.send(encodeWsClientRequest({ jsonrpc: "2.0", id, method, params }))
        const result = await vi.waitFor(() => {
          const response = responses.get(id)
          if (!response) throw new Error(`Missing response to request ${id}`)
          return response
        })
        responses.delete(id)
        return result
      },
    }
  }

  return {
    connectWs,
    events: () =>
      fetch(`${route}/events`, {
        signal: AbortSignal.any([end.signal, AbortSignal.timeout(8_000)]),
      }),
    post: (path: "rpc" | "reply", body: unknown, headers?: Record<string, string>) =>
      fetch(`${route}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      }),
    get host() {
      const host = agentSessionRegistry.getHost(agentId)
      if (!host) throw new Error("Session host has not opened")
      return host
    },
    get callbacks() {
      if (!callbacks) throw new Error("ACP callbacks have not been registered")
      return callbacks
    },
    async stop() {
      end.abort()
      for (const ws of sockets) {
        if (ws.readyState !== WebSocket.CLOSED) ws.terminate()
      }
      stack.stop()
      stack.sessionWss.close()
      stack.echoWss.close()
      await agentSessionRegistry.getHost(agentId)?.dispose()
      agentSessionRegistry.unregisterHost(agentId)
      agentSessionRegistry.stop()
      await connectionRegistry.close(agentId)
      await new Promise<void>((resolve) => server.close(() => resolve()))
      setSelfBaseUrlForTests(undefined)
    },
  }
}

function readSse(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  return async function nextFrame(): Promise<ChannelFrame> {
    for (;;) {
      const separator = buffer.indexOf("\n\n")
      if (separator === -1) {
        const read = await reader.read()
        if (read.done) throw new Error("SSE stream ended")
        buffer += decoder.decode(read.value, { stream: true })
        continue
      }
      const text = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const event = /^event: (.+)$/m.exec(text)?.[1]
      if (event === STREAM_ALIVE_EVENT) continue
      const id = /^id: (.+)$/m.exec(text)?.[1]
      const data = /^data: (.*)$/m.exec(text)?.[1]
      if (!event || data === undefined) throw new Error("Invalid SSE frame")
      return { event, ...(id !== undefined ? { id } : {}), data }
    }
  }
}

function frameUpdates(frame: ChannelFrame): unknown[] {
  if (frame.event === "snapshot") return (JSON.parse(frame.data) as SnapshotPayload).updates
  if (frame.event === "update") {
    return (JSON.parse(frame.data) as { params: { update: unknown } }[]).map(
      (event) => event.params.update,
    )
  }
  return []
}

function expectOutput(frames: ChannelFrame[]) {
  const updates = frames.flatMap(frameUpdates)
  expect(updates).toContainEqual(
    expect.objectContaining({
      _meta: expect.objectContaining({ [TOOL_OUTPUT_META_KEY]: expect.any(Object) }),
    }),
  )
  const state = updates.reduce<SessionState>(
    (acc, update) => reduce(acc, update).state,
    createInitialSessionState({ sessionId }),
  )
  expect(state.messages[0]).toMatchObject({
    role: "tool",
    toolCall: { output: { text: "one\ntwo\n", exitCode: 3 } },
  })
}

it("streams identical frames including epoch, permission and canonical tool output", async () => {
  const h = await setup()
  try {
    const response = await h.events()
    expect(response.status).toBe(200)
    if (!response.body) throw new Error("Missing SSE body")
    const nextSse = readSse(response.body)
    const sse = [await nextSse()]
    const ws = h.connectWs()
    await vi.waitFor(() => expect(ws.frames[0]?.event).toBe("snapshot"))
    expect(JSON.parse(sse[0]?.data ?? "{}")).toMatchObject({ epoch: 1 })

    const toolCallId = "exec-fixture"
    const update = { sessionUpdate: "tool_call_update", toolCallId }
    const terminalFrames = [
      { sessionUpdate: "tool_call", toolCallId, kind: "execute", _meta: { terminal_info: {} } },
      { ...update, _meta: { terminal_output_delta: { data: "one\n" } } },
      { ...update, _meta: { terminal_output_delta: { data: "two\n" } } },
      { ...update, status: "failed", _meta: { terminal_exit: { exit_code: 3 } } },
    ]
    const notify = h.callbacks.onUpdate
    if (!notify) throw new Error("Missing onUpdate")
    for (const frame of terminalFrames) {
      notify({ sessionId, update: frame } as Parameters<typeof notify>[0])
    }
    const ask = h.callbacks.onRequestPermission
    if (!ask) throw new Error("Missing permission callback")
    const pending = ask({
      sessionId,
      toolCall: { toolCallId, status: "failed" },
      options: [],
    })
    const lastId = String(h.host.state.version)
    while (sse.at(-1)?.id !== lastId) sse.push(await nextSse())
    await vi.waitFor(() => expect(ws.frames.at(-1)?.id).toBe(lastId))

    expect(ws.frames).toEqual(sse)
    for (const frames of [sse, ws.frames]) {
      expect(frames.slice(1)).toHaveLength(5)
      expect(frameUpdates(frames.at(-1) as ChannelFrame)).toContainEqual(
        expect.objectContaining({
          changes: expect.objectContaining({
            pending: expect.objectContaining({
              permission: expect.objectContaining({ requestId: expect.any(Number) }),
            }),
          }),
        }),
      )
      expectOutput(frames)
    }

    const late = h.connectWs()
    await vi.waitFor(() => expect(late.frames[0]?.event).toBe("snapshot"))
    expect(late.frames[0]?.id).toBe(lastId)
    expectOutput(late.frames)

    const permissionId = h.host.state.pending.permission?.requestId
    if (permissionId === undefined) throw new Error("Permission is not pending")
    h.host.respondPermission(permissionId, { outcome: { outcome: "cancelled" } })
    await pending
  } finally {
    await h.stop()
  }
}, 12_000)

it("returns the same statuses and bodies for RPC and reply on both transports", async () => {
  const h = await setup()
  vi.stubEnv("SCOPE_MESSAGE_POLICY", "deny")
  try {
    const ws = h.connectWs()
    const scopedHeaders = { "X-Drive-Coding-Scope": issueToken("out-of-subtree") }
    const denied = h.connectWs(scopedHeaders)
    await vi.waitFor(() => {
      expect(ws.frames[0]?.event).toBe("snapshot")
      expect(denied.frames[0]?.event).toBe("snapshot")
    })
    const prompt = { sessionId, content: "Parity" }
    const cases = [
      { path: "rpc", body: { method: "session/list", params: {} }, status: 200 },
      { path: "rpc", body: { method: "unknown/fixture", params: {} }, status: 400 },
      { path: "rpc", body: { method: "session/prompt", params: prompt, waitMs: -1 }, status: 400 },
      {
        path: "rpc",
        body: { method: "session/prompt", params: { content: "No session" } },
        status: 400,
      },
      {
        path: "reply",
        body: { kind: "permission", requestId: 42, result: { outcome: { outcome: "cancelled" } } },
        status: 200,
      },
      {
        path: "rpc",
        body: { method: "session/prompt", params: prompt },
        status: 403,
        scoped: true,
      },
    ] as const
    for (const row of cases) {
      const scoped = "scoped" in row
      const http = await h.post(row.path, row.body, scoped ? scopedHeaders : undefined)
      const socket = scoped ? denied : ws
      expect(http.status, row.path + JSON.stringify(row.body)).toBe(row.status)
      expect(
        await socket.request(row.path === "rpc" ? WS_RPC_METHOD : WS_REPLY_METHOD, row.body),
      ).toEqual({
        status: http.status,
        body: await http.json(),
      })
    }
    const throwing = { method: "session/set_mode", params: { modeId: "throw" } }
    const http = await h.post("rpc", throwing)
    expect(http.status).toBe(500)
    expect((await ws.request(WS_RPC_METHOD, throwing)).status).toBe(http.status)
  } finally {
    vi.unstubAllEnvs()
    await h.stop()
  }
})

it("reports auth metadata in SSE 401 and before WS closes with 4401", async () => {
  const authMethods = [{ id: "fixture", name: "Sign in" }]
  const body = { error: "sign in", kind: "auth_required", authMethods }
  const h = await setup({ authError: Object.assign(new Error(body.error), body) })
  try {
    const sse = await h.events()
    expect(sse.status).toBe(401)
    expect(await sse.json()).toEqual(body)

    const ws = h.connectWs()
    const [code] = await ws.closed
    expect(code).toBe(4401)
    expect(ws.frames).toEqual([{ event: "error", data: JSON.stringify(body) }])
  } finally {
    await h.stop()
  }
})

it("delivers a complete WS snapshot with approximately 30 MiB of tool output", async () => {
  const toolCount = 480
  const output = { text: "x".repeat(65_536), exitCode: 0 }
  let state = createInitialSessionState({ sessionId })
  for (let i = 0; i < toolCount; i++) {
    state = applyToolMessage(state, {
      toolCallId: `large-${i}`,
      name: "output-fixture",
      args: {},
      status: "completed",
      output,
    }).state
  }
  const h = await setup({ snapshotState: state })
  try {
    const start = performance.now()
    const ws = h.connectWs()
    await vi.waitFor(() => expect(ws.frames[0]?.event).toBe("snapshot"), { timeout: 8_000 })
    const elapsed = Math.round(performance.now() - start)
    const frame = ws.frames[0]
    if (!frame) throw new Error("Expected snapshot frame")
    expect(frame.id).toBe(String(state.version))
    const calls = frameUpdates(frame).filter(
      (update): update is { _meta: Record<string, { set: unknown }> } =>
        typeof update === "object" &&
        update !== null &&
        "_meta" in update &&
        typeof update._meta === "object" &&
        update._meta !== null &&
        TOOL_OUTPUT_META_KEY in update._meta,
    )
    expect(calls).toHaveLength(toolCount)
    expect(
      calls.every((call) => {
        const set = call._meta[TOOL_OUTPUT_META_KEY]?.set as typeof output | undefined
        return set?.text === output.text && set.exitCode === output.exitCode
      }),
    ).toBe(true)
    console.info(`WS snapshot: ${Buffer.byteLength(frame.data)} bytes in ${elapsed} ms`)
  } finally {
    await h.stop()
  }
}, 12_000)
