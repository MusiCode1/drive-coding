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
import { createAgentWsHandler, TAKEOVER_CODE } from "../src/delivery/ws-agent.js"

// ─── Mock ProviderConnection ──────────────────────────────────────────────────

function makeMockConn(pid = 12345): {
  conn: ProviderConnection
  pushLine: (line: string) => void
  triggerCrash: () => void
  writeSpy: ReturnType<typeof vi.fn>
} {
  // slice reconnect-ws-takeover: real conn.wire.onLine supports multiple simultaneous
  // subscribers (stream-bridge.test.ts "multiple onLine subscribers"). During a takeover,
  // the old feWs's onLine subscriber and the new feWs's onLine subscriber briefly coexist
  // (old detach()'s unsub() runs async, after the new one already subscribed) — a single
  // shared `lineCallback` variable would let the old unsub() wipe out the new subscriber.
  const lineListeners = new Set<(line: string) => void>()
  let crashCallback: (() => void) | null = null
  const writeSpy = vi.fn((_line: string) => true)

  const conn: ProviderConnection = {
    wire: {
      onLine(cb) {
        lineListeners.add(cb)
        return () => {
          lineListeners.delete(cb)
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
    pushLine: (line: string) => {
      for (const cb of lineListeners) cb(line)
    },
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
    markAttached: markAttachedSpy,
    markDetached: markDetachedSpy,
    getRuntimeInfo: vi.fn(() => null),
    isAttached: vi.fn(() => false),
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

  // ─── takeover (slice reconnect-ws-takeover) ─────────────────────────────────
  // MED-8 root fix: the old reject-with-1008 behavior is replaced by takeover —
  // the NEW WS evicts the OLD one (close TAKEOVER_CODE) and warm-attaches to the
  // same live agent, instead of being rejected itself. See §3 architecture diagram.

  it("takeover: second connection evicts the first (close TAKEOVER_CODE), attach falls through", () => {
    const { conn } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry, markAttachedSpy } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws: ws1, closeArgs: close1 } = makeMockFeWs()
    const { ws: ws2, closeArgs: close2 } = makeMockFeWs()

    onConnect(ws1, "dup-agent")
    onConnect(ws2, "dup-agent")

    // old (ws1) is evicted with the dedicated takeover code — not 1008/1006/1000
    expect(close1).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
    expect(close1[0]![0]).toBe(TAKEOVER_CODE)

    // ws2 is NOT rejected — it falls through to normal attach
    expect(close2).toHaveLength(0)

    // both attaches ran (markAttached called for ws1's initial attach, then ws2's takeover attach)
    expect(markAttachedSpy).toHaveBeenCalledTimes(2)
  })

  it("takeover race: old close-handler does not clobber the new attach's shared state", async () => {
    const { conn } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry, markDetachedSpy } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws: ws1 } = makeMockFeWs()
    const { ws: ws2 } = makeMockFeWs()

    onConnect(ws1, "race-agent")
    onConnect(ws2, "race-agent") // evicts ws1 synchronously (ws1.close(TAKEOVER_CODE) called)

    // simulate the real "close" event that a WS actually emits some time after .close() —
    // this is the race: ws1's detach() runs AFTER ws2 already attached (activeFeWs.set + markAttached).
    ws1.emit("close")
    await new Promise((r) => setTimeout(r, 20))

    // guard must have skipped the shared-state clear (activeFeWs/markDetached) for ws1's
    // stale detach — ws2 is still the live attachment, so no markDetached should fire.
    expect(markDetachedSpy).not.toHaveBeenCalled()
  })

  it("takeover race: frame from child after takeover reaches the NEW feWs, not the evicted one", async () => {
    const { conn, pushLine } = makeMockConn()
    const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
    const { connectionRegistry } = makeMockConnectionRegistry(conn)

    const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
    const { ws: ws1, sent: sent1 } = makeMockFeWs()
    const { ws: ws2, sent: sent2 } = makeMockFeWs()

    onConnect(ws1, "frame-agent")
    onConnect(ws2, "frame-agent") // takeover
    ws1.emit("close") // old close-handler fires (unsub of ws1's onLine subscriber)
    await new Promise((r) => setTimeout(r, 20))

    const line = JSON.stringify({ jsonrpc: "2.0", method: "test", params: { turn: "survives" } })
    pushLine(line)
    await new Promise((r) => setTimeout(r, 20))

    expect(sent2).toContain(`${line}\n`)
    expect(sent1).not.toContain(`${line}\n`)
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

  // ─── slice remote-warm-reconnect C2: guard WS→host ─────────────────────────

  describe("sessionHostRegistry guard (C2)", () => {
    it("agent with a live session host → close(1008, 'session-host-active'), no pipe attached", async () => {
      const { conn, writeSpy } = makeMockConn()
      const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
      const { connectionRegistry, markAttachedSpy } = makeMockConnectionRegistry(conn)
      // SessionHost חי על הסוכן — getHost מחזיר אובייקט (לא undefined)
      const sessionHostRegistry = { getHost: vi.fn(() => ({})) }

      const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry, sessionHostRegistry })
      const { ws, closeArgs } = makeMockFeWs()

      onConnect(ws, "hosted-agent")

      expect(closeArgs).toHaveLength(1)
      // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
      expect(closeArgs[0]![0]).toBe(1008)
      // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength
      expect(closeArgs[0]![1]).toBe("session-host-active")
      // אין pipe: לא markAttached, לא העברת הודעות ל-wire
      expect(markAttachedSpy).not.toHaveBeenCalled()
      ws.emit("message", JSON.stringify({ jsonrpc: "2.0", method: "initialize" }))
      await new Promise((r) => setTimeout(r, 20))
      expect(writeSpy).not.toHaveBeenCalled()
    })

    it("no host + no sessionHostRegistry dep → existing behavior unchanged (regression)", async () => {
      const { conn, writeSpy } = makeMockConn()
      const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
      const { connectionRegistry, markAttachedSpy } = makeMockConnectionRegistry(conn)

      // בלי sessionHostRegistry בכלל — הנתיב הקיים
      const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry })
      const { ws, closeArgs } = makeMockFeWs()

      onConnect(ws, "plain-agent")

      expect(closeArgs).toHaveLength(0)
      expect(markAttachedSpy).toHaveBeenCalledTimes(1)
      ws.emit("message", JSON.stringify({ jsonrpc: "2.0", method: "initialize" }))
      await new Promise((r) => setTimeout(r, 20))
      expect(writeSpy).toHaveBeenCalled()
    })

    it("sessionHostRegistry present but getHost returns undefined → attach proceeds (no host)", async () => {
      const { conn } = makeMockConn()
      const orchestrator = { getBridgePort: vi.fn(() => 0) } as never
      const { connectionRegistry, markAttachedSpy } = makeMockConnectionRegistry(conn)
      const sessionHostRegistry = { getHost: vi.fn(() => undefined) }

      const onConnect = createAgentWsHandler({ orchestrator, connectionRegistry, sessionHostRegistry })
      const { ws, closeArgs } = makeMockFeWs()

      onConnect(ws, "no-host-agent")

      expect(closeArgs).toHaveLength(0)
      expect(markAttachedSpy).toHaveBeenCalledTimes(1)
      expect(sessionHostRegistry.getHost).toHaveBeenCalledWith("no-host-agent")
    })
  })
})
