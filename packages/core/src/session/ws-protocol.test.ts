import { describe, expect, it } from "vitest"
import {
  closeCodeForStatus,
  decodeWsClientMessage,
  decodeWsServerMessage,
  encodeWsClientRequest,
  encodeWsControl,
  encodeWsFrame,
  encodeWsServerResponse,
  statusForCloseCode,
  WS_REPLY_METHOD,
  WS_RPC_METHOD,
} from "./ws-protocol"

describe("WebSocket session protocol", () => {
  it.each([WS_RPC_METHOD, WS_REPLY_METHOD] as const)("round-trips a %s request", (method) => {
    const request = { jsonrpc: "2.0", id: 1, method, params: { value: true } } as const
    expect(decodeWsClientMessage(encodeWsClientRequest(request))).toEqual({
      kind: "request",
      request,
    })
  })

  it.each([
    { event: "snapshot", id: "7", data: "{}" },
    { event: "stream-alive", data: "{}" },
  ])("round-trips a frame with event $event", (frame) => {
    expect(decodeWsServerMessage(encodeWsFrame(frame))).toEqual({ kind: "frame", frame })
  })

  it("round-trips a response", () => {
    const result = { status: 403, body: { error: "denied" } }
    expect(decodeWsServerMessage(encodeWsServerResponse(1, result))).toEqual({
      kind: "response",
      response: { jsonrpc: "2.0", id: 1, result },
    })
  })

  it("round-trips control notifications and accepts the legacy ping shape", () => {
    expect(decodeWsClientMessage(encodeWsControl("$/ping"))).toEqual({ kind: "ping" })
    expect(decodeWsClientMessage(encodeWsControl("$/detach"))).toEqual({ kind: "detach" })
    expect(decodeWsServerMessage(encodeWsControl("$/pong"))).toEqual({ kind: "pong" })
    expect(decodeWsClientMessage('{"jsonrpc":"2.0","method":"$/ping"}')).toEqual({
      kind: "ping",
    })
    expect(decodeWsClientMessage('{"jsonrpc":"2.0","id":1,"method":"$/ping"}')).toBeNull()
  })

  it("maps application close codes to statuses", () => {
    expect(closeCodeForStatus(409)).toBe(4409)
    expect(statusForCloseCode(4409)).toBe(409)
    expect(statusForCloseCode(3999)).toBeUndefined()
    expect(statusForCloseCode(5000)).toBeUndefined()
  })

  it.each(["{", "null", "[]", '{"event":"snapshot","data":{}}', '{"jsonrpc":"2.0","id":1}'])(
    "rejects malformed messages (%s)",
    (raw) => {
      expect(decodeWsClientMessage(raw)).toBeNull()
      expect(decodeWsServerMessage(raw)).toBeNull()
    },
  )
})
