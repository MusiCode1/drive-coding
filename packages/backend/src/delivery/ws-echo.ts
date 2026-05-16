import { ClientMessage, type ServerMessage } from "@drive-coding/core"
import { type } from "arktype"
import type { ServerWebSocket, WebSocketHandler } from "bun"
import type { Hono } from "hono"

export type WsData = { id: string }

function send(ws: ServerWebSocket<WsData>, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg))
}

export function registerEchoWs(_app: Hono): {
  websocket: WebSocketHandler<WsData>
} {
  const websocket: WebSocketHandler<WsData> = {
    open(ws) {
      send(ws, { type: "hello", version: "0.0.0" })
    },
    message(ws, raw) {
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
    },
    close() {
      // cleanup later
    },
  }
  return { websocket }
}
