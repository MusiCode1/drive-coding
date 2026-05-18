/**
 * ws-to-streams.test.ts — TDD for FE WebSocket → Web Streams bridge
 *
 * Key behaviors (post-F1 fix — direct in-process pipe, no stdio-to-ws wrapper):
 * 1. Every WS frame forwarded as-is to readable (no filtering of synthetic frames).
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

  // ── Readable: forward-all (no filtering — post-stdio-to-ws) ───────────────

  it("forwards {type:'connected'}-shaped frames as-is (no filtering)", async () => {
    // After F-1 fix removed stdio-to-ws, no synthetic wrapper frames exist.
    // ws-to-streams must forward every WS frame as-is to the SDK.
    const ws = new TestWebSocket() as unknown as WebSocket
    const { readable } = wsToWebStreams(ws)
    const reader = readable.getReader()

    const frame = '{"type":"connected","clientId":"abc"}'
    ;(ws as unknown as TestWebSocket).emit("message", { data: frame })

    const { value } = await reader.read()
    const decoder = new TextDecoder()
    const text = decoder.decode(value)
    expect(text).toBe(frame)
    reader.releaseLock()
  })

  it("forwards arbitrary non-ACP-shaped frames as-is (no filtering of unknown 'type' fields)", async () => {
    const ws = new TestWebSocket() as unknown as WebSocket
    const { readable } = wsToWebStreams(ws)
    const reader = readable.getReader()

    const frame = '{"type":"heartbeat"}'
    ;(ws as unknown as TestWebSocket).emit("message", { data: frame })

    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toBe(frame)
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
