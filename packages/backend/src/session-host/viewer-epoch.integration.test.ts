import { once } from "node:events"
import {
  createInitialSessionState,
  decodeWsServerMessage,
  type Patch,
} from "@drive-coding/core/session"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { expect, it, vi } from "vitest"
import { WebSocket } from "ws"
import { createConnectionRegistry } from "../acp/connection-registry.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import type { BootDeps } from "../boot/deps.js"
import { createWsStack } from "../boot/ws.js"
import { openViewer } from "./channel/viewer-stream.js"
import { createAgentSessionRegistry } from "./registry.js"
import type { ExtendedSessionHost } from "./session-host.js"

vi.mock("../acp/open-connection.js", () => ({
  openProviderConnection: vi.fn(async () => ({
    capabilities: {},
    wire: { onLine: () => () => {}, write: () => true },
    onFrame: () => () => {},
    onCrash: () => () => {},
    close: async () => {},
  })),
}))

it("ends an expired SSE viewer without takeover when a WS viewer has joined", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
  const agentId = "viewer-epoch"
  const connectionRegistry = createConnectionRegistry()
  const registry = createAgentSessionRegistry({
    connectionRegistry,
    _createHostFn: async () =>
      ({
        state: createInitialSessionState({ sessionId: "session" }),
        patches: new ReadableStream<Patch>(),
      }) as ExtendedSessionHost,
    _httpOwnerTtlMs: 100,
    _httpSweepMs: 10,
  })
  const open = (connectionId: string, via: "http" | "ws") =>
    openViewer(
      { registry, connectionRegistry },
      { agentId, connectionId, via, clientEpoch: undefined },
    )
  try {
    await connectionRegistry.connect(agentId, "opencode", { cwd: process.cwd() })
    const sse = await open("sse", "http")
    if (!sse.ok) throw new Error("SSE viewer did not open")
    const sseWrite = vi.fn(async () => {})
    const sseEnd = sse.run({ write: sseWrite })
    await vi.advanceTimersByTimeAsync(90)

    const ws = await open("ws", "ws")
    if (!ws.ok) throw new Error("WS viewer did not open")
    const wsEnd = ws.run({ write: async () => {} })
    await vi.advanceTimersByTimeAsync(20)

    expect(await sseEnd).toBe("ended")
    expect(sseWrite).toHaveBeenCalledTimes(1)
    expect(connectionRegistry.getEpoch(agentId)).toBe(1)
    expect(connectionRegistry.getConnectionCount(agentId)).toBe(1)
    ws.cancel()
    expect(await wsEnd).toBe("cancelled")
  } finally {
    registry.stop()
    registry.unregisterHost(agentId)
    await connectionRegistry.close(agentId)
    vi.useRealTimers()
  }
})

it.each(["ttl", "delete"] as const)("closes a routed WS viewer on %s", async (release) => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
  const agentId = "viewer-epoch"
  const connectionRegistry = createConnectionRegistry()
  let patchController: ReadableStreamDefaultController<Patch> | undefined
  const host = {
    state: createInitialSessionState({ sessionId: "session" }),
    patches: new ReadableStream<Patch>({
      start(controller) {
        patchController = controller
      },
    }),
    async dispose() {
      patchController?.close()
    },
  } as ExtendedSessionHost
  const agentSessionRegistry = createAgentSessionRegistry({
    connectionRegistry,
    _createHostFn: async () => host,
    _httpOwnerTtlMs: 100,
    _httpSweepMs: 10,
  })
  const app = new Hono()
  const stack = createWsStack()
  stack.wireRoutes(app, {
    agentSessionRegistry,
    connectionRegistry,
    registry: createInMemoryAgentRegistry(),
  } as BootDeps)
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  stack.attachUpgradeHandler(server)
  const sockets: WebSocket[] = []
  try {
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("No bound port")
    await connectionRegistry.connect(agentId, "opencode", { cwd: process.cwd() })

    const base = `127.0.0.1:${address.port}`
    const session = new WebSocket(`ws://${base}/ws/session/${agentId}?connectionId=viewer`)
    sockets.push(session)
    const closed = once(session, "close")
    void closed.catch(() => {})
    const [initial] = await once(session, "message")
    expect(decodeWsServerMessage(String(initial))).toMatchObject({
      kind: "frame",
      frame: { event: "snapshot" },
    })

    if (release === "ttl") {
      await vi.advanceTimersByTimeAsync(110)
      expect(connectionRegistry.listViewerRows(agentId)).toEqual([])
    } else if (release === "delete") {
      const result = await fetch(`http://${base}/api/agents/${agentId}/connection`, {
        method: "DELETE",
        headers: { "Acp-Connection-Id": "viewer" },
      })
      expect(result.status).toBe(204)
      expect(connectionRegistry.getConnectionCount(agentId)).toBe(0)
    }
    const [code] = await closed
    expect(code).toBe(1000)
  } finally {
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
    }
    stack.stop()
    stack.sessionWss.close()
    stack.echoWss.close()
    agentSessionRegistry.stop()
    agentSessionRegistry.unregisterHost(agentId)
    await connectionRegistry.close(agentId)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.useRealTimers()
  }
})
