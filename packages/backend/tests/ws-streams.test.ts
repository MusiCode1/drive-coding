import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { WebSocket as WsWebSocket } from "ws"
import { wsToStreams } from "../src/acp/ws-streams"

/**
 * Mock that mimics ws.WebSocket: emits "message" / "close" / "error",
 * exposes `send`, `close`, `readyState` + constants.
 */
class MockWebSocket extends EventEmitter {
  static OPEN = 1 as const
  static CLOSED = 3 as const
  readonly OPEN = 1
  readonly CLOSED = 3
  readyState: number = 1
  send = vi.fn((_data: string) => {})
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = this.CLOSED
  })
}

function makeWs(): { ws: MockWebSocket; cast: WsWebSocket } {
  const ws = new MockWebSocket()
  return { ws, cast: ws as unknown as WsWebSocket }
}

/**
 * Collects all chunks pushed to the readable stream as decoded text strings.
 * Returns the chunks array (mutated as new chunks arrive) + a stop function.
 */
function collectReadable(stream: ReadableStream<Uint8Array>): {
  chunks: string[]
  stop: () => void
  closed: Promise<void>
} {
  const chunks: string[] = []
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let stopped = false
  const closed = (async () => {
    while (!stopped) {
      try {
        const { value, done } = await reader.read()
        if (done) return
        if (value) chunks.push(decoder.decode(value))
      } catch {
        return
      }
    }
  })()
  return {
    chunks,
    stop: () => {
      stopped = true
      reader.releaseLock()
    },
    closed,
  }
}

describe("wsToStreams — readable (WS → Stream)", () => {
  it("ACP JSON-RPC frame passes through as-is", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    const frame = '{"jsonrpc":"2.0","id":1,"method":"prompt"}\n'
    ws.emit("message", Buffer.from(frame, "utf8"))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([frame])
  })

  it('"connected" wrapper frame is swallowed', async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    ws.emit("message", Buffer.from('{"type":"connected","clientId":"abc"}'))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([])
  })

  it('"heartbeat" wrapper frame is swallowed', async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    ws.emit("message", Buffer.from('{"type":"heartbeat"}'))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([])
  })

  it('"disconnected" wrapper frame is swallowed', async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    ws.emit("message", Buffer.from('{"type":"disconnected"}'))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([])
  })

  it("unknown non-ACP frame is swallowed (no bytes forwarded)", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    ws.emit("message", Buffer.from('{"type":"unknown_xyz"}'))
    await new Promise((r) => setImmediate(r))

    // Frame is swallowed — no bytes forwarded to stream
    expect(chunks).toEqual([])
  })

  it("partial JSON-RPC frame (no trailing \\n) is forwarded as-is — NOT padded", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    const partial = '{"jsonrpc":"2.0","id":1,"meth'
    ws.emit("message", Buffer.from(partial, "utf8"))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([partial]) // no \n appended
  })

  it("complete JSON-RPC frame ending in \\n passes through verbatim", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    const frame = '{"jsonrpc":"2.0","id":1,"result":{}}\n'
    ws.emit("message", Buffer.from(frame, "utf8"))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([frame])
    expect(chunks[0]?.endsWith("\n")).toBe(true)
    // no double \n
    expect(chunks[0]?.endsWith("\n\n")).toBe(false)
  })

  it("complete JSON-RPC frame without trailing \\n passes through verbatim (no \\n added)", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    const frame = '{"jsonrpc":"2.0","id":1,"result":{}}'
    ws.emit("message", Buffer.from(frame, "utf8"))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([frame])
    expect(chunks[0]?.endsWith("\n")).toBe(false)
  })

  it("2 frames split mid-JSON: both forwarded, SDK joins later", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    const a = '{"jsonrpc":"2.0","id":1,"resu'
    const b = 'lt":{"foo":"bar"}}\n'

    ws.emit("message", Buffer.from(a, "utf8"))
    ws.emit("message", Buffer.from(b, "utf8"))
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual([a, b])
    // Joined together this is a complete JSON-RPC message
    expect((chunks[0] ?? "") + (chunks[1] ?? "")).toBe(a + b)
  })

  it("string data (not Buffer) is handled equivalently", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { chunks } = collectReadable(readable)

    ws.emit("message", '{"jsonrpc":"2.0","id":1}\n')
    await new Promise((r) => setImmediate(r))

    expect(chunks).toEqual(['{"jsonrpc":"2.0","id":1}\n'])
  })

  it("ws close → controller.close()", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const { closed } = collectReadable(readable)

    ws.emit("close")
    await closed
    // collectReadable returns from done — no throw
  })

  it("ws error → controller.error()", async () => {
    const { ws, cast } = makeWs()
    const { readable } = wsToStreams(cast)
    const reader = readable.getReader()

    ws.emit("error", new Error("boom"))

    await expect(reader.read()).rejects.toThrow("boom")
  })

  it("double close on ws does not throw (guard against already-closed controller)", async () => {
    const { ws, cast } = makeWs()
    wsToStreams(cast)
    ws.emit("close")
    expect(() => ws.emit("close")).not.toThrow()
  })
})

describe("wsToStreams — writable (Stream → WS)", () => {
  it("single NDJSON line → one ws.send call with line + \\n", async () => {
    const { ws, cast } = makeWs()
    const { writable } = wsToStreams(cast)
    const writer = writable.getWriter()

    const line = '{"jsonrpc":"2.0","id":1,"method":"prompt"}\n'
    await writer.write(new TextEncoder().encode(line))

    expect(ws.send).toHaveBeenCalledTimes(1)
    expect(ws.send).toHaveBeenCalledWith(line)
    writer.releaseLock()
  })

  it("two NDJSON lines in one chunk → two ws.send calls", async () => {
    const { ws, cast } = makeWs()
    const { writable } = wsToStreams(cast)
    const writer = writable.getWriter()

    const chunk = '{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","id":2}\n'
    await writer.write(new TextEncoder().encode(chunk))

    expect(ws.send).toHaveBeenCalledTimes(2)
    expect(ws.send).toHaveBeenNthCalledWith(1, '{"jsonrpc":"2.0","id":1}\n')
    expect(ws.send).toHaveBeenNthCalledWith(2, '{"jsonrpc":"2.0","id":2}\n')
    writer.releaseLock()
  })

  it("empty line in chunk → no extra frame sent", async () => {
    const { ws, cast } = makeWs()
    const { writable } = wsToStreams(cast)
    const writer = writable.getWriter()

    await writer.write(new TextEncoder().encode('{"x":1}\n\n{"y":2}\n'))

    expect(ws.send).toHaveBeenCalledTimes(2)
    writer.releaseLock()
  })

  it("ws.send throws (socket closed mid-write) → swallowed silently", async () => {
    const { ws, cast } = makeWs()
    ws.send.mockImplementation(() => {
      throw new Error("WebSocket is not open")
    })
    const { writable } = wsToStreams(cast)
    const writer = writable.getWriter()

    await expect(writer.write(new TextEncoder().encode('{"x":1}\n'))).resolves.toBeUndefined()
    writer.releaseLock()
  })

  it("close() on writable → ws.close() when OPEN", async () => {
    const { ws, cast } = makeWs()
    const { writable } = wsToStreams(cast)
    await writable.close()
    expect(ws.close).toHaveBeenCalledTimes(1)
  })

  it("close() on writable when ws already CLOSED → no ws.close", async () => {
    const { ws, cast } = makeWs()
    ws.readyState = ws.CLOSED
    const { writable } = wsToStreams(cast)
    await writable.close()
    expect(ws.close).not.toHaveBeenCalled()
  })

  it("abort(reason) on writable → ws.close(1011, reason)", async () => {
    const { ws, cast } = makeWs()
    const { writable } = wsToStreams(cast)
    await writable.abort("upstream failure")
    expect(ws.close).toHaveBeenCalledWith(1011, "upstream failure")
  })
})
