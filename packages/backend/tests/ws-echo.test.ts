import type { ServerWebSocket } from "bun"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import { registerEchoWs, type WsData } from "../src/delivery/ws-echo"

function makeWs(): { ws: ServerWebSocket<WsData>; sent: string[] } {
  const sent: string[] = []
  const ws = {
    data: { id: "test" },
    send: vi.fn((d: unknown) => {
      sent.push(typeof d === "string" ? d : String(d))
    }),
  } as unknown as ServerWebSocket<WsData>
  return { ws, sent }
}

describe("registerEchoWs", () => {
  it("open() sends 'hello' with version", () => {
    const { websocket } = registerEchoWs(new Hono())
    const { ws, sent } = makeWs()
    websocket.open?.(ws)

    expect(sent).toHaveLength(1)
    const parsed = JSON.parse(sent[0] ?? "")
    expect(parsed.type).toBe("hello")
    expect(parsed.version).toBeDefined()
  })

  it("ping message → pong with echoOf + serverTime", () => {
    const { websocket } = registerEchoWs(new Hono())
    const { ws, sent } = makeWs()
    websocket.message?.(ws, JSON.stringify({ type: "ping" }))

    const parsed = JSON.parse(sent[0] ?? "")
    expect(parsed.type).toBe("pong")
    expect(parsed.echoOf).toBe("ping")
    expect(typeof parsed.serverTime).toBe("number")
  })

  it("invalid JSON → error INVALID_JSON", () => {
    const { websocket } = registerEchoWs(new Hono())
    const { ws, sent } = makeWs()
    websocket.message?.(ws, "not-json{{{{")

    const parsed = JSON.parse(sent[0] ?? "")
    expect(parsed.type).toBe("error")
    expect(parsed.code).toBe("INVALID_JSON")
  })

  it("unknown message type → error INVALID_MSG", () => {
    const { websocket } = registerEchoWs(new Hono())
    const { ws, sent } = makeWs()
    websocket.message?.(ws, JSON.stringify({ type: "subscribe" }))

    const parsed = JSON.parse(sent[0] ?? "")
    expect(parsed.type).toBe("error")
    expect(parsed.code).toBe("INVALID_MSG")
  })
})
