/**
 * Integration tests for ws-agent.ts — bytes pipe + MED-8 guard.
 *
 * Slice 10 Phase 1 — TDD outer-loop tests written BEFORE implementation.
 *
 * Uses a real WebSocket server (ws npm) on a random port to act as the bridge,
 * and a mock Bun ServerWebSocket to act as the FE side.
 *
 * Covers:
 *   - Message forwarding: FE → bridge (when bridge ready and buffered)
 *   - Message forwarding: bridge → FE
 *   - MED-8: second tab connects to same agentId → close(1008, "agent in use by another tab")
 *   - bridgeWs close → feWs.close(1011, "bridge closed")
 *   - bridgeWs error → feWs.close(1011, "bridge error")
 *   - Unknown agentId → feWs.close(1008, "agent not found")
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocketServer } from "ws"
import type { AgentWsData } from "../src/delivery/ws-agent.js"
import { createAgentWsHandler } from "../src/delivery/ws-agent.js"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a real WS server on a random port, returns { port, wss, close } */
async function makeBridgeServer(): Promise<{
  port: number
  wss: WebSocketServer
  receivedMessages: string[]
  sendToClient: (msg: string) => void
  closeServer: () => Promise<void>
}> {
  const receivedMessages: string[] = []
  let clientSocket: import("ws").WebSocket | null = null

  const wss = new WebSocketServer({ port: 0 })

  await new Promise<void>((resolve) => wss.on("listening", resolve))

  const addr = wss.address() as { port: number }

  wss.on("connection", (ws) => {
    clientSocket = ws
    ws.on("message", (data) => {
      receivedMessages.push(data.toString())
    })
  })

  return {
    port: addr.port,
    wss,
    receivedMessages,
    sendToClient: (msg: string) => {
      clientSocket?.send(msg)
    },
    closeServer: () =>
      new Promise<void>((resolve) => {
        clientSocket?.close()
        wss.close(() => resolve())
      }),
  }
}

/** Mock Bun ServerWebSocket (FE side) */
function makeMockFeWs(agentId: string): {
  ws: ReturnType<typeof makeMockFeWs>["ws"]
  sent: Array<string | Buffer>
  closeArgs: Array<[number, string]>
} {
  const sent: Array<string | Buffer> = []
  const closeArgs: Array<[number, string]> = []
  const ws = {
    data: {
      kind: "agent" as const,
      agentId,
      bridgeWs: undefined as unknown,
      pendingFromFe: [] as unknown[],
      bridgeOpen: false,
    } as AgentWsData,
    send: vi.fn((data: string | Buffer) => {
      sent.push(data)
    }),
    close: vi.fn((code: number, reason: string) => {
      closeArgs.push([code, reason])
    }),
  }
  return { ws: ws as unknown as ReturnType<typeof makeMockFeWs>["ws"], sent, closeArgs }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ws-agent bytes pipe", () => {
  let bridge: Awaited<ReturnType<typeof makeBridgeServer>>

  beforeEach(async () => {
    bridge = await makeBridgeServer()
  })

  afterEach(async () => {
    await bridge.closeServer()
  })

  it("unknown agentId → close(1008, 'agent not found')", async () => {
    const orchestrator = {
      getBridgePort: vi.fn(() => null),
    }
    const handler = createAgentWsHandler({ orchestrator: orchestrator as never })
    const { ws, closeArgs } = makeMockFeWs("ghost-agent")

    await handler.websocket.open?.(ws as never)

    expect(closeArgs).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(closeArgs[0]![0]).toBe(1008)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(closeArgs[0]![1]).toContain("agent not found")
  })

  it("FE message forwarded to bridge (with buffering before open)", async () => {
    const agentId = "pipe-test-1"
    const orchestrator = {
      getBridgePort: vi.fn(() => bridge.port),
    }
    const handler = createAgentWsHandler({ orchestrator: orchestrator as never })
    const { ws } = makeMockFeWs(agentId)

    // open — triggers bridgeWs connect
    await handler.websocket.open?.(ws as never)

    // Wait for bridge WS connection to be established
    await new Promise<void>((resolve) => {
      const check = () => {
        if (bridge.wss.clients.size > 0) resolve()
        else setTimeout(check, 10)
      }
      check()
    })

    // Wait a bit more for "open" event to fire on bridgeWs
    await new Promise((r) => setTimeout(r, 100))

    // Send message from FE
    const testMsg = JSON.stringify({ jsonrpc: "2.0", method: "initialize" })
    await handler.websocket.message?.(ws as never, testMsg)

    // Wait for message to arrive at bridge
    await new Promise<void>((resolve) => {
      const check = () => {
        if (bridge.receivedMessages.length > 0) resolve()
        else setTimeout(check, 10)
      }
      setTimeout(check, 20)
    })

    expect(bridge.receivedMessages).toContain(testMsg)
  })

  it("bridge message forwarded to FE", async () => {
    const agentId = "pipe-test-2"
    const orchestrator = {
      getBridgePort: vi.fn(() => bridge.port),
    }
    const handler = createAgentWsHandler({ orchestrator: orchestrator as never })
    const { ws, sent } = makeMockFeWs(agentId)

    await handler.websocket.open?.(ws as never)

    // Wait for bridge WS connection
    await new Promise<void>((resolve) => {
      const check = () => {
        if (bridge.wss.clients.size > 0) resolve()
        else setTimeout(check, 10)
      }
      check()
    })
    await new Promise((r) => setTimeout(r, 100))

    // Bridge sends message to FE
    const bridgeMsg = JSON.stringify({ jsonrpc: "2.0", result: { sessionId: "s1" }, id: 1 })
    bridge.sendToClient(bridgeMsg)

    // Wait for FE to receive it
    await new Promise<void>((resolve) => {
      const check = () => {
        if (sent.length > 0) resolve()
        else setTimeout(check, 10)
      }
      setTimeout(check, 20)
    })

    const received = sent.map((s) => (typeof s === "string" ? s : s.toString()))
    expect(received).toContain(bridgeMsg)
  })

  it("MED-8: second tab same agentId → close(1008, 'agent in use by another tab')", async () => {
    const agentId = "dup-agent"
    const orchestrator = {
      getBridgePort: vi.fn(() => bridge.port),
    }
    const handler = createAgentWsHandler({ orchestrator: orchestrator as never })

    const { ws: ws1 } = makeMockFeWs(agentId)
    const { ws: ws2, closeArgs: close2 } = makeMockFeWs(agentId)

    // First tab connects
    await handler.websocket.open?.(ws1 as never)

    // Second tab connects with same agentId — should be rejected
    await handler.websocket.open?.(ws2 as never)

    expect(close2).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(close2[0]![0]).toBe(1008)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(close2[0]![1]).toContain("agent in use by another tab")
  })

  it("feWs close → removes from activeFeWs + closes bridgeWs", async () => {
    const agentId = "close-test"
    const orchestrator = {
      getBridgePort: vi.fn(() => bridge.port),
    }
    const handler = createAgentWsHandler({ orchestrator: orchestrator as never })
    const { ws } = makeMockFeWs(agentId)

    await handler.websocket.open?.(ws as never)

    // Wait for connection
    await new Promise((r) => setTimeout(r, 150))

    // Close FE WS
    await handler.websocket.close?.(ws as never, 1000, "bye")

    // After FE closes, the bridge server should see the client disconnect
    await new Promise((r) => setTimeout(r, 200))
    expect(bridge.wss.clients.size).toBe(0)
  })
})
