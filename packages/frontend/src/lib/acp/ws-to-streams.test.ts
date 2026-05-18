/**
 * ws-to-streams.test.ts — TDD for FE WebSocket → Web Streams bridge
 *
 * Key behaviors:
 * 1. stdio-to-ws wrapper frames (connected/heartbeat/disconnected/error) are
 *    swallowed THROUGHOUT the session (not only during handshake).
 * 2. ACP frames forwarded as-is — NO extra \n added (would corrupt partial NDJSON).
 * 3. Writable: chunk → split on \n → each non-empty line sent as separate WS frame
 *    with \n suffix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Minimal MockWebSocket for WS → Streams tests ──────────────────────────────

class TestWebSocket {
  static OPEN = 1
  readyState = 1
  sent: string[] = []
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {}

  addEventListener(event: string, fn: (...args: unknown[]) => void) {
    const list = this.listeners[event] ?? []
    list.push(fn)
    this.listeners[event] = list
  }

  removeEventListener(event: string, fn: (...args: unknown[]) => void) {
    const list = this.listeners[event]
    if (list) {
      this.listeners[event] = list.filter((f) => f !== fn)
    }
  }

  emit(event: string, ...args: unknown[]) {
    const list = this.listeners[event]
    if (list) {
      for (const fn of list) {
        fn(...args)
      }
    }
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.emit("close")
  }
}

describe("wsToWebStreams", () => {
  // Dynamic import so we can mock BEFORE the module loads
  let wsToWebStreams: (ws: WebSocket) => {
    readable: ReadableStream<Uint8Array>
    writable: WritableStream<Uint8Array>
  }

  beforeEach(async () => {
    // Re-import fresh each time (module cache reuse is fine here since no mocks at module level)
    const mod = await import("./ws-to-streams.js")
    wsToWebStreams = mod.wsToWebStreams
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ── Readable: filter tests ──────────────────────────────────────────────────

  it("swallows stdio-to-ws 'connected' frame and does NOT enqueue it", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { readable } = wsToWebStreams(ws)

    const reader = readable.getReader()

    // Send a connected frame — should be swallowed
    ;(ws as unknown as TestWebSocket).emit("message", {
      data: '{"type":"connected","clientId":"abc"}',
    })

    // Then send an ACP frame — should arrive
    ;(ws as unknown as TestWebSocket).emit("message", {
      data: '{"jsonrpc":"2.0","id":1,"result":{}}',
    })

    const { value } = await reader.read()
    const decoder = new TextDecoder()
    const text = decoder.decode(value)
    expect(text).toContain('"jsonrpc"')
    expect(text).not.toContain('"type":"connected"')
    reader.releaseLock()
  })

  it("swallows stdio-to-ws 'heartbeat' frames (sent periodically throughout session)", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { readable } = wsToWebStreams(ws)
    const reader = readable.getReader()

    // Multiple heartbeats
    ;(ws as unknown as TestWebSocket).emit("message", { data: '{"type":"heartbeat"}' })
    ;(ws as unknown as TestWebSocket).emit("message", { data: '{"type":"heartbeat"}' })

    // Then real ACP message
    ;(ws as unknown as TestWebSocket).emit("message", {
      data: '{"jsonrpc":"2.0","method":"notifications/sessionUpdate","params":{}}',
    })

    const { value } = await reader.read()
    const decoder = new TextDecoder()
    const text = decoder.decode(value)
    expect(text).toContain("sessionUpdate")
    expect(text).not.toContain("heartbeat")
    reader.releaseLock()
  })

  it("swallows 'disconnected' and 'error' stdio-to-ws frames", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { readable } = wsToWebStreams(ws)
    const reader = readable.getReader()

    ;(ws as unknown as TestWebSocket).emit("message", { data: '{"type":"disconnected"}' })
    ;(ws as unknown as TestWebSocket).emit("message", {
      data: '{"type":"error","message":"oops"}',
    })
    ;(ws as unknown as TestWebSocket).emit("message", {
      data: '{"jsonrpc":"2.0","id":2,"result":{}}',
    })

    const { value } = await reader.read()
    const decoder = new TextDecoder()
    const text = decoder.decode(value)
    expect(text).toContain('"jsonrpc"')
    expect(text).not.toContain('"type":"disconnected"')
    expect(text).not.toContain('"type":"error"')
    reader.releaseLock()
  })

  it("forwards ACP JSON-RPC frames as-is WITHOUT adding extra \\n (partial NDJSON safety)", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { readable } = wsToWebStreams(ws)
    const reader = readable.getReader()

    const acpFrame =
      '{"jsonrpc":"2.0","method":"notifications/sessionUpdate","params":{"type":"agent_message_chunk","text":"hello"}}'
    ;(ws as unknown as TestWebSocket).emit("message", { data: acpFrame })

    const { value } = await reader.read()
    const decoder = new TextDecoder()
    const text = decoder.decode(value)
    // Should be EXACTLY the original frame — no trailing \n added
    expect(text).toBe(acpFrame)
    reader.releaseLock()
  })

  it("closes readable when WebSocket closes", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { readable } = wsToWebStreams(ws)
    const reader = readable.getReader()

    ;(ws as unknown as TestWebSocket).close()

    const { done } = await reader.read()
    expect(done).toBe(true)
    reader.releaseLock()
  })

  // ── Writable: send tests ────────────────────────────────────────────────────

  it("writable: splits chunk on \\n and sends each non-empty line as separate frame with \\n suffix", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { writable } = wsToWebStreams(ws)

    const encoder = new TextEncoder()
    const writer = writable.getWriter()

    // The SDK typically writes `{...}\n` per message — we simulate two messages
    await writer.write(
      encoder.encode(
        '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"method":"session/new"}\n',
      ),
    )
    writer.releaseLock()

    const tws = ws as unknown as TestWebSocket
    expect(tws.sent).toHaveLength(2)
    expect(tws.sent[0]).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n')
    expect(tws.sent[1]).toBe('{"jsonrpc":"2.0","id":2,"method":"session/new"}\n')
  })

  it("writable: does NOT send empty lines (trailing newline or double-newlines)", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { writable } = wsToWebStreams(ws)

    const encoder = new TextEncoder()
    const writer = writable.getWriter()
    // Trailing newline after message creates empty line on split
    await writer.write(encoder.encode('{"jsonrpc":"2.0","method":"ping"}\n\n'))
    writer.releaseLock()

    const tws = ws as unknown as TestWebSocket
    // Only ONE frame sent — the empty string from trailing \n is ignored
    expect(tws.sent).toHaveLength(1)
    expect(tws.sent[0]).toBe('{"jsonrpc":"2.0","method":"ping"}\n')
  })

  it("writable: single line without trailing \\n still sent with \\n suffix", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { writable } = wsToWebStreams(ws)

    const encoder = new TextEncoder()
    const writer = writable.getWriter()
    await writer.write(encoder.encode('{"jsonrpc":"2.0","method":"$/ping"}'))
    writer.releaseLock()

    const tws = ws as unknown as TestWebSocket
    expect(tws.sent).toHaveLength(1)
    expect(tws.sent[0]).toBe('{"jsonrpc":"2.0","method":"$/ping"}\n')
  })
})
