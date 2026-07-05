/**
 * ws-agent-pipe.test.ts — Integration tests for ws-agent.ts (CUT-3b-ii rewire)
 *
 * Phase 3 rewrite: direct in-process pipe via ProviderConnection (conn.wire).
 * Uses mock ConnectionRegistry to act as the registry.
 *
 * CUT-3b-ii changes:
 *   - bridgeManager.getChild → connectionRegistry.get (presence check)
 *   - bridgeManager.onLine → conn.wire.onLine
 *   - bridgeManager.writeStdin → conn.wire.write
 *   - child.once("exit") → conn.onCrash (crash notification to feWs)
 *   - markAttached/markDetached → connectionRegistry
 *
 * Covers:
 *   - Agent not found → close(1008, "agent not found")
 *   - MED-8: second tab connects to same agentId → close(1008, "agent in use by another tab")
 *   - FE message forwarded to conn.wire.write
 *   - conn.wire.onLine → forwarded to FE via feWs.send
 *   - conn.onCrash fires → feWs.close(1011, "bridge closed")
 *   - feWs close → cleanup (unsub called), conn NOT closed
 */

import { EventEmitter } from "node:stream"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WebSocket } from "ws"
import type { ConnectionRegistry } from "../src/acp/connection-registry.js"
import { createAgentWsHandler } from "../src/delivery/ws-agent.js"

// ─── Mock ProviderConnection ──────────────────────────────────────────────────

function makeMockConn(pid = 12345): {
  conn: ProviderConnection
  pushLine: (line: string) => void
  triggerCrash: () => void
  writeSpy: ReturnType<typeof vi.fn>
} {
  let lineCallback: ((line: string) => void) | null = null
  let crashCallback: (() => void) | null = null
  const writeSpy = vi.fn((_line: string) => true)

  const conn: ProviderConnection = {
    wire: {
      onLine(cb) {
        lineCallback = cb
        return () => {
          lineCallback = null
        }
      },
      write: writeSpy,
    },
    capabilities: {
      supportsModelFlag: false,
      supportsSessionResume: false,
      supportsConfigOptions: false,
    },
    onFrame: vi.fn(() => () => {}),
    turn: {
      isBusy: vi.fn(() => false),
      lastActivityAt: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
    },
    onCrash(cb) {
      crashCallback = cb
      return () => {
        crashCallback = null
      }
    },
    close: vi.fn(async () => {}),
    ext: undefined,
    get pid() {
      return pid
    },
  } as ProviderConnection

  return {
    conn,
    pushLine: (line: string) => lineCallback?.(line),
    triggerCrash: () => crashCallback?.({ exitCode: 1, signal: null } as never),
    writeSpy,
  }
}

// ─── Mock ConnectionRegistry ──────────────────────────────────────────────────

function makeMockConnectionRegistry(conn: ProviderConnection | null): {
  connectionRegistry: ConnectionRegistry
  markAttachedSpy: ReturnType<typeof vi.fn>
  markDetachedSpy: ReturnType<typeof vi.fn>
} {
  const markAttachedSpy = vi.fn()
  const markDetachedSpy = vi.fn()

  const connectionRegistry: ConnectionRegistry = {
    connect: vi.fn(
      async () =>
        conn ??
        (() => {
          throw new Error("not found")
        })(),
    ),
    get: vi.fn(() => conn ?? undefined),
    list: vi.fn(() => []),
    markAttached: markAttachedSpy,
    markDetached: markDetachedSpy,
    getRuntimeInfo: vi.fn(() => null),
    close: vi.fn(async () => {}),
    onCrash: vi.fn(() => () => {}),
  }

  return { connectionRegistry, markAttachedSpy, markDetachedSpy }
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
  emitter.readyState = 1
  return { ws: emitter as unknown as WebSocket, sent, closeArgs }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ws-agent in-process pipe (CUT-3b-ii)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("unknown agentId → close(1008, 'agent not found')", () => {
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(null)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws, closeArgs } = makeMockFeWs()

    onConnect(ws, "ghost-agent")

    expect(closeArgs).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(closeArgs[0]![0]).toBe(1008)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(closeArgs[0]![1]).toContain("agent not found")
  })

  it("FE message forwarded to conn.wire.write", async () => {
    const { conn, writeSpy } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws } = makeMockFeWs()

    onConnect(ws, "agent-1")

    const msg = JSON.stringify({ jsonrpc: "2.0", method: "initialize" })
    ws.emit("message", msg)

    await new Promise((r) => setTimeout(r, 20))
    // message must be forwarded to conn.wire.write (with \n appended if missing)
    expect(writeSpy).toHaveBeenCalledWith(`${msg}\n`)
  })

  it("$/ping keepalive → replies $/pong and does NOT forward to conn.wire.write", async () => {
    const { conn, writeSpy } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws, sent } = makeMockFeWs()

    onConnect(ws, "ping-agent")

    ws.emit("message", JSON.stringify({ jsonrpc: "2.0", method: "$/ping" }))

    await new Promise((r) => setTimeout(r, 20))

    expect(sent).toContain(`${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it("child.stdout line forwarded to FE with \\n preserved (NDJSON delimiter)", async () => {
    const { conn, pushLine } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws, sent } = makeMockFeWs()

    onConnect(ws, "agent-2")

    const line = JSON.stringify({ jsonrpc: "2.0", result: { sessionId: "s1" }, id: 1 })
    pushLine(line)

    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toContain(`${line}\n`)
  })

  it("MED-8: second tab same agentId → close(1008, 'agent in use by another tab')", () => {
    const { conn } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws: ws1 } = makeMockFeWs()
    const { ws: ws2, closeArgs: close2 } = makeMockFeWs()

    onConnect(ws1, "dup-agent")
    onConnect(ws2, "dup-agent")

    expect(close2).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(close2[0]![0]).toBe(1008)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(close2[0]![1]).toContain("agent in use by another tab")
  })

  it("child exit (onCrash) → feWs.close(1011, 'bridge closed')", async () => {
    const { conn, triggerCrash } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws, closeArgs } = makeMockFeWs()

    onConnect(ws, "exit-agent")

    triggerCrash()

    await new Promise((r) => setTimeout(r, 20))
    expect(closeArgs.some(([code]) => code === 1011)).toBe(true)
    expect(closeArgs.some(([, reason]) => reason === "bridge closed")).toBe(true)
  })

  it("feWs close → cleanup (unsub called), conn NOT closed", async () => {
    const { conn } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws } = makeMockFeWs()

    onConnect(ws, "close-agent")

    ws.emit("close", 1000, "bye")

    await new Promise((r) => setTimeout(r, 50))

    // conn.close must NOT be called — child survives FE disconnect
    expect(conn.close).not.toHaveBeenCalled()
  })
})
