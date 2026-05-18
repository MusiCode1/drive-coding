/**
 * ws-agent-pipe.test.ts — Integration tests for ws-agent.ts
 *
 * Phase 3 rewrite: direct in-process pipe via ChildProcess stdin/stdout.
 * Uses mock ChildProcess (EventEmitter + PassThrough streams) to act as the child.
 *
 * Covers:
 *   - Agent not found → close(1008, "agent not found")
 *   - MED-8: second tab connects to same agentId → close(1008, "agent in use by another tab")
 *   - FE message forwarded to child.stdin
 *   - child.stdout line → forwarded to FE via feWs.send
 *   - child exit → feWs.close(1011, "bridge closed")
 *   - feWs close → cleanup (rl detached), child NOT killed
 */

import { EventEmitter, PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WebSocket } from "ws"
import { createAgentWsHandler } from "../src/delivery/ws-agent.js"

// ─── Mock ChildProcess ────────────────────────────────────────────────────────

type MockChild = EventEmitter & {
  pid: number
  stdout: PassThrough
  stderr: PassThrough
  stdin: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function makeMockChild(pid = 12345): MockChild {
  const child = new EventEmitter() as MockChild
  child.pid = pid
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.kill = vi.fn()
  return child
}

// ─── Mock FE WebSocket ────────────────────────────────────────────────────────

type MockFeWs = EventEmitter & {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  readyState: number
}

function makeMockFeWs(): { ws: WebSocket; sent: string[]; closeArgs: Array<[number, string]> } {
  const sent: string[] = []
  const closeArgs: Array<[number, string]> = []
  const emitter = new EventEmitter() as MockFeWs
  emitter.send = vi.fn((data: unknown) => {
    sent.push(typeof data === "string" ? data : String(data))
  })
  emitter.close = vi.fn((code: number, reason: string) => {
    closeArgs.push([code, reason])
  })
  emitter.readyState = 1 // OPEN
  return { ws: emitter as unknown as WebSocket, sent, closeArgs }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ws-agent in-process pipe", () => {
  it("unknown agentId → close(1008, 'agent not found')", () => {
    const orchestrator = { getBridgePort: vi.fn(() => null) } as never
    const bridgeManager = { getChild: vi.fn(() => null) }

    const onConnect = createAgentWsHandler({ orchestrator, bridgeManager })
    const { ws, closeArgs } = makeMockFeWs()

    onConnect(ws, "ghost-agent")

    expect(closeArgs).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(closeArgs[0]![0]).toBe(1008)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(closeArgs[0]![1]).toContain("agent not found")
  })

  it("FE message forwarded to child.stdin", async () => {
    const child = makeMockChild()
    const orchestrator = { getBridgePort: vi.fn(() => null) } as never
    const bridgeManager = { getChild: vi.fn(() => child) }

    const onConnect = createAgentWsHandler({ orchestrator, bridgeManager })
    const { ws } = makeMockFeWs()

    onConnect(ws, "agent-1")

    // Capture stdin writes
    const stdinChunks: string[] = []
    child.stdin.on("data", (chunk) => stdinChunks.push(chunk.toString()))

    // Emit FE message
    const msg = JSON.stringify({ jsonrpc: "2.0", method: "initialize" })
    ws.emit("message", msg)

    await new Promise((r) => setTimeout(r, 20))
    expect(stdinChunks.join("")).toContain(msg)
  })

  it("child.stdout line forwarded to FE with \\n preserved (NDJSON delimiter)", async () => {
    // The FE consumes the WS stream via ndJsonStream which parses on \n boundary.
    // If BE strips \n (readline does that), the SDK waits forever for completion.
    // Therefore BE must re-append \n before sending each line.
    const child = makeMockChild()
    const orchestrator = { getBridgePort: vi.fn(() => null) } as never
    const bridgeManager = { getChild: vi.fn(() => child) }

    const onConnect = createAgentWsHandler({ orchestrator, bridgeManager })
    const { ws, sent } = makeMockFeWs()

    onConnect(ws, "agent-2")

    // Send a line from child stdout (with \n as opencode emits NDJSON)
    const line = JSON.stringify({ jsonrpc: "2.0", result: { sessionId: "s1" }, id: 1 })
    child.stdout.write(`${line}\n`)

    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toContain(`${line}\n`)
  })

  it("MED-8: second tab same agentId → close(1008, 'agent in use by another tab')", () => {
    const child = makeMockChild()
    const orchestrator = { getBridgePort: vi.fn(() => null) } as never
    const bridgeManager = { getChild: vi.fn(() => child) }

    const onConnect = createAgentWsHandler({ orchestrator, bridgeManager })
    const { ws: ws1 } = makeMockFeWs()
    const { ws: ws2, closeArgs: close2 } = makeMockFeWs()

    // First tab connects
    onConnect(ws1, "dup-agent")

    // Second tab connects with same agentId — should be rejected
    onConnect(ws2, "dup-agent")

    expect(close2).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(close2[0]![0]).toBe(1008)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(close2[0]![1]).toContain("agent in use by another tab")
  })

  it("child exit → feWs.close(1011, 'bridge closed')", async () => {
    const child = makeMockChild()
    const orchestrator = { getBridgePort: vi.fn(() => null) } as never
    const bridgeManager = { getChild: vi.fn(() => child) }

    const onConnect = createAgentWsHandler({ orchestrator, bridgeManager })
    const { ws, closeArgs } = makeMockFeWs()

    onConnect(ws, "exit-agent")

    // Simulate child exit
    child.emit("exit", 0)

    await new Promise((r) => setTimeout(r, 20))
    expect(closeArgs.some(([code]) => code === 1011)).toBe(true)
    expect(closeArgs.some(([, reason]) => reason === "bridge closed")).toBe(true)
  })

  it("feWs close → cleanup, child NOT killed", async () => {
    const child = makeMockChild()
    const orchestrator = { getBridgePort: vi.fn(() => null) } as never
    const bridgeManager = { getChild: vi.fn(() => child) }

    const onConnect = createAgentWsHandler({ orchestrator, bridgeManager })
    const { ws } = makeMockFeWs()

    onConnect(ws, "close-agent")

    // Close FE WS
    ws.emit("close", 1000, "bye")

    await new Promise((r) => setTimeout(r, 50))

    // Child should NOT be killed
    expect(child.kill).not.toHaveBeenCalled()
  })
})
