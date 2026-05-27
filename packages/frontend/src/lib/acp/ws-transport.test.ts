/**
 * ws-transport.test.ts — Tests for WsAcpTransport.
 *
 * Uses a TestWebSocket stub injected via the constructor's second parameter.
 * This lets us drive open/close/message events synchronously without happy-dom
 * WebSocket support.
 *
 * Coverage:
 *   1. binaryType is set to "arraybuffer".
 *   2. waitForOpen resolves on "open" event.
 *   3. waitForOpen rejects on "error" event.
 *   4. close() calls ws.close().
 *   5. WS close → onClose listeners fire with code+reason.
 *   6. Multiple onClose listeners all fire.
 *   7. Heartbeat $/ping starts after open, every 25s.
 *   8. Heartbeat stops on close.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { WsAcpTransport } from "./ws-transport.js"

// ── Minimal TestWebSocket ─────────────────────────────────────────────────────
class TestWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  readyState = TestWebSocket.CONNECTING
  binaryType: BinaryType = "blob"
  url: string
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}

  constructor(url = "ws://test/agent/abc") {
    this.url = url
  }

  addEventListener(event: string, fn: (ev: unknown) => void) {
    const list = this.listeners[event] ?? []
    list.push(fn)
    this.listeners[event] = list
  }

  removeEventListener(event: string, fn: (ev: unknown) => void) {
    const list = this.listeners[event]
    if (list) this.listeners[event] = list.filter((f) => f !== fn)
  }

  _emit(event: string, ev: unknown) {
    const list = this.listeners[event]
    if (list) {
      for (const fn of list.slice()) fn(ev)
    }
  }

  send(data: string) {
    if (this.readyState !== TestWebSocket.OPEN) {
      throw new Error("WS not open")
    }
    this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = TestWebSocket.CLOSED
    this._emit("close", { code: code ?? 1000, reason: reason ?? "" })
  }

  // ── Test driver helpers ─────────────────────────────────────────────────────
  fireOpen() {
    this.readyState = TestWebSocket.OPEN
    this._emit("open", {})
  }

  fireError() {
    this._emit("error", new Event("error"))
  }

  fireClose(code: number, reason: string) {
    this.readyState = TestWebSocket.CLOSED
    this._emit("close", { code, reason })
  }
}

describe("WsAcpTransport — basic semantics", () => {
  test("constructor sets binaryType to arraybuffer", () => {
    const ws = new TestWebSocket()
    new WsAcpTransport("ws://test", ws as unknown as WebSocket)
    expect(ws.binaryType).toBe("arraybuffer")
  })

  test("close() calls ws.close()", () => {
    const ws = new TestWebSocket()
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)
    ws.fireOpen()
    t.close()
    expect(ws.readyState).toBe(TestWebSocket.CLOSED)
  })

  test("waitForOpen resolves on open event", async () => {
    const ws = new TestWebSocket()
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)

    let resolved = false
    const p = t.waitForOpen().then(() => {
      resolved = true
    })

    expect(resolved).toBe(false)
    ws.fireOpen()
    await p
    expect(resolved).toBe(true)
  })

  test("waitForOpen rejects on error event", async () => {
    const ws = new TestWebSocket()
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)

    const p = t.waitForOpen()
    ws.fireError()
    await expect(p).rejects.toThrow(/WS connect failed/)
  })

  test("waitForOpen returns immediately when already open", async () => {
    const ws = new TestWebSocket()
    ws.readyState = TestWebSocket.OPEN
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)

    await t.waitForOpen()
    // No assertion needed — if it didn't resolve, the test would time out.
    expect(true).toBe(true)
  })
})

describe("WsAcpTransport — close events", () => {
  test("WS close fires onClose listeners with code+reason", () => {
    const ws = new TestWebSocket()
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)

    const events: Array<{ code: number; reason: string }> = []
    t.onClose((code, reason) => events.push({ code, reason }))

    ws.fireClose(1008, "agent in use by another tab")

    expect(events).toEqual([{ code: 1008, reason: "agent in use by another tab" }])
  })

  test("multiple onClose listeners all fire", () => {
    const ws = new TestWebSocket()
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)
    let a = 0
    let b = 0
    t.onClose(() => a++)
    t.onClose(() => b++)

    ws.fireClose(1000, "")

    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  test("close() also fires onClose (via WS close event)", () => {
    const ws = new TestWebSocket()
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)
    ws.fireOpen()

    let fired = false
    t.onClose(() => {
      fired = true
    })

    t.close()

    expect(fired).toBe(true)
  })
})

describe("WsAcpTransport — heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("$/ping is sent every 25s after open", () => {
    const ws = new TestWebSocket()
    new WsAcpTransport("ws://test", ws as unknown as WebSocket)
    ws.fireOpen()

    expect(ws.sent).toHaveLength(0)

    vi.advanceTimersByTime(25_000)
    expect(ws.sent).toHaveLength(1)
    expect(ws.sent[0]).toContain(`"method":"$/ping"`)
    expect(ws.sent[0]).toMatch(/\n$/)

    vi.advanceTimersByTime(25_000)
    expect(ws.sent).toHaveLength(2)
  })

  test("heartbeat does not start until open event fires", () => {
    const ws = new TestWebSocket()
    new WsAcpTransport("ws://test", ws as unknown as WebSocket)

    // ws is still CONNECTING — advance timers, expect no sends
    vi.advanceTimersByTime(100_000)
    expect(ws.sent).toHaveLength(0)
  })

  test("heartbeat stops on close", () => {
    const ws = new TestWebSocket()
    const t = new WsAcpTransport("ws://test", ws as unknown as WebSocket)
    ws.fireOpen()

    vi.advanceTimersByTime(25_000)
    expect(ws.sent).toHaveLength(1)

    t.close()

    // After close, advancing time should not send more pings
    vi.advanceTimersByTime(100_000)
    expect(ws.sent).toHaveLength(1)
  })

  test("heartbeat stops on WS-initiated close", () => {
    const ws = new TestWebSocket()
    new WsAcpTransport("ws://test", ws as unknown as WebSocket)
    ws.fireOpen()

    vi.advanceTimersByTime(25_000)
    expect(ws.sent).toHaveLength(1)

    ws.fireClose(1011, "bridge crashed")

    vi.advanceTimersByTime(100_000)
    expect(ws.sent).toHaveLength(1)
  })
})
