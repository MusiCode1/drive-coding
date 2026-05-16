import { type } from "arktype"

// Client → Server (Slice 1: ping only)
export const PingMessage = type({ type: "'ping'" })
export type PingMessage = typeof PingMessage.infer

export const ClientMessage = PingMessage // נרחיב ב-Slice הבא

// Server → Client
export const HelloMessage = type({ type: "'hello'", version: "string" })
export const PongMessage = type({
  type: "'pong'",
  echoOf: "string",
  serverTime: "number",
})
export const ErrorMessage = type({ type: "'error'", message: "string" })

export const ServerMessage = HelloMessage.or(PongMessage).or(ErrorMessage)
export type ServerMessage = typeof ServerMessage.infer
