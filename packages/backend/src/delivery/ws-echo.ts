import { ClientMessage, type ServerMessage } from "@drive-coding/core"
import { type } from "arktype"
import type { WebSocket } from "ws"

export type WsData = { id: string }

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg))
}

export function createEchoWsHandler(): (ws: WebSocket) => void {
  return function onConnect(ws: WebSocket): void {
    send(ws, { type: "hello", version: "0.0.0" })

    ws.on("message", (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        send(ws, { type: "error", code: "INVALID_JSON", message: "invalid json" })
        return
      }
      const result = ClientMessage(parsed)
      if (result instanceof type.errors) {
        send(ws, { type: "error", code: "INVALID_MSG", message: result.summary })
        return
      }
      if (result.type === "ping") {
        send(ws, {
          type: "pong",
          echoOf: "ping",
          serverTime: Date.now(),
        })
      }
    })

    ws.on("close", () => {
      // cleanup later
    })
  }
}
