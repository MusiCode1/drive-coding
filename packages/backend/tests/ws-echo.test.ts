import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { createEchoWsHandler, type WsData } from "../src/delivery/ws-echo"

// Mock ws.WebSocket (only the parts we use: send + on/off/once/emit via EventEmitter)
function makeWs(): { ws: import("ws").WebSocket; sent: string[] } {
  const sent: string[] = []
  const emitter = new EventEmitter()
  const ws = Object.assign(emitter, {
    data: { id: "test" } as WsData,
    send: vi.fn((d: unknown) => {
      sent.push(typeof d === "string" ? d : String(d))
    }),
    close: vi.fn(),
  }) as unknown as import("ws").WebSocket
  return { ws, sent }
}

describe("createEchoWsHandler", () => {
  it("on connect sends 'hello' with version", () => {
    const handler = createEchoWsHandler()
    const { ws, sent } = makeWs()
    handler(ws)

    expect(sent).toHaveLength(1)
    const parsed = JSON.parse(sent[0] ?? "")
    expect(parsed.type).toBe("hello")
    expect(parsed.version).toBeDefined()
  })

  it("ping message → pong with echoOf + serverTime", () => {
    const handler = createEchoWsHandler()
    const { ws, sent } = makeWs()
    handler(ws)

    // Emit a message event (as ws library does)
    ws.emit("message", JSON.stringify({ type: "ping" }))

    const pong = sent.find((s) => s.includes("pong"))
    expect(pong).toBeDefined()
    const parsed = JSON.parse(pong ?? "")
    expect(parsed.type).toBe("pong")
    expect(parsed.echoOf).toBe("ping")
    expect(typeof parsed.serverTime).toBe("number")
  })

  it("invalid JSON → error INVALID_JSON", () => {
    const handler = createEchoWsHandler()
    const { ws, sent } = makeWs()
    handler(ws)

    ws.emit("message", "not-json{{{{")

    const errMsg = sent.find((s) => s.includes("INVALID_JSON"))
    expect(errMsg).toBeDefined()
    const parsed = JSON.parse(errMsg ?? "")
    expect(parsed.type).toBe("error")
    expect(parsed.code).toBe("INVALID_JSON")
  })

  it("unknown message type → error INVALID_MSG", () => {
    const handler = createEchoWsHandler()
    const { ws, sent } = makeWs()
    handler(ws)

    ws.emit("message", JSON.stringify({ type: "subscribe" }))

    const errMsg = sent.find((s) => s.includes("INVALID_MSG"))
    expect(errMsg).toBeDefined()
    const parsed = JSON.parse(errMsg ?? "")
    expect(parsed.type).toBe("error")
    expect(parsed.code).toBe("INVALID_MSG")
  })
})
