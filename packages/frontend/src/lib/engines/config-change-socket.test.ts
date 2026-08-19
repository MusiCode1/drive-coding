/**
 * config-change-socket.test.ts — tests for createConfigChangeSocket
 * (slice cli-specs-hot-reload, Commit 2).
 *
 * Uses wsFactory to inject a WebSocket stub (no real socket), so the reconnect
 * path is testable with fake timers — the same seam as WsAcpTransport(url, ws?).
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { createConfigChangeSocket } from "./config-change-socket"

function makeWsStub(): {
  ws: WebSocket
  addEventListener: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  fire: (event: string, ev?: unknown) => void
} {
  const listeners = new Map<string, Array<(ev: unknown) => void>>()
  const addEventListener = vi.fn((event: string, cb: (ev: unknown) => void) => {
    const list = listeners.get(event) ?? []
    list.push(cb)
    listeners.set(event, list)
  })
  const close = vi.fn()
  const ws = { addEventListener, removeEventListener: vi.fn(), close } as unknown as WebSocket
  return {
    ws,
    addEventListener,
    close,
    fire(event: string, ev: unknown = {}): void {
      for (const cb of listeners.get(event) ?? []) cb(ev)
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("createConfigChangeSocket", () => {
  it("start() opens the socket and forwards config_changed to onConfigChanged", () => {
    const stub = makeWsStub()
    const factory = vi.fn(() => stub.ws)
    const onConfigChanged = vi.fn()
    const sock = createConfigChangeSocket({
      url: "ws://x/ws/echo",
      onConfigChanged,
      wsFactory: factory,
    })

    sock.start()
    expect(factory).toHaveBeenCalledWith("ws://x/ws/echo")

    stub.fire("message", { data: JSON.stringify({ type: "config_changed", timestamp: 1 }) })
    expect(onConfigChanged).toHaveBeenCalledTimes(1)

    sock.stop()
  })

  it("ignores non-config messages", () => {
    const stub = makeWsStub()
    const onConfigChanged = vi.fn()
    const sock = createConfigChangeSocket({
      url: "u",
      onConfigChanged,
      wsFactory: () => stub.ws,
    })

    sock.start()
    stub.fire("message", { data: JSON.stringify({ type: "hello", version: "0.0.0" }) })
    expect(onConfigChanged).not.toHaveBeenCalled()
    sock.stop()
  })

  it("ignores malformed JSON", () => {
    const stub = makeWsStub()
    const onConfigChanged = vi.fn()
    const sock = createConfigChangeSocket({
      url: "u",
      onConfigChanged,
      wsFactory: () => stub.ws,
    })

    sock.start()
    stub.fire("message", { data: "not-json{{{{" })
    expect(onConfigChanged).not.toHaveBeenCalled()
    sock.stop()
  })

  it("start() is idempotent — only one socket", () => {
    const factory = vi.fn(() => makeWsStub().ws)
    const sock = createConfigChangeSocket({ url: "u", onConfigChanged: vi.fn(), wsFactory: factory })

    sock.start()
    sock.start()
    expect(factory).toHaveBeenCalledTimes(1)
    sock.stop()
  })

  it("stop() closes the socket and prevents reconnect", () => {
    vi.useFakeTimers()
    const stub = makeWsStub()
    const factory = vi.fn(() => stub.ws)
    const sock = createConfigChangeSocket({ url: "u", onConfigChanged: vi.fn(), wsFactory: factory })

    sock.start()
    sock.stop()
    expect(stub.close).toHaveBeenCalled()

    // close event after stop must not schedule a reconnect
    stub.fire("close", { code: 1000, reason: "" })
    vi.advanceTimersByTime(2000)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it("reconnects after the socket closes", () => {
    vi.useFakeTimers()
    const first = makeWsStub()
    const second = makeWsStub()
    const factory = vi.fn().mockReturnValueOnce(first.ws).mockReturnValueOnce(second.ws)
    const sock = createConfigChangeSocket({ url: "u", onConfigChanged: vi.fn(), wsFactory: factory })

    sock.start()
    expect(factory).toHaveBeenCalledTimes(1)

    first.fire("close", { code: 1006, reason: "" })
    vi.advanceTimersByTime(1000)
    expect(factory).toHaveBeenCalledTimes(2)

    sock.stop()
  })
})
