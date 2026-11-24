import { createInitialSessionState, type Patch } from "@drive-coding/core/session"
import { expect, it, vi } from "vitest"
import { createConnectionRegistry } from "../acp/connection-registry.js"
import { openViewer } from "./channel/viewer-stream.js"
import { createAgentSessionRegistry } from "./registry.js"
import type { ExtendedSessionHost } from "./session-host.js"

vi.mock("../acp/open-connection.js", () => ({
  openProviderConnection: vi.fn(async () => ({
    capabilities: {},
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
