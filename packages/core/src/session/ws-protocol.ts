import { type } from "arktype"
import type { SseFrame } from "./wire-frames"

export type ChannelFrame = SseFrame
export const WS_SESSION_PATH_PREFIX = "/ws/session/"
export const WS_RPC_METHOD = "_drive/rpc"
export const WS_REPLY_METHOD = "_drive/reply"

export type WsClientRequest = {
  jsonrpc: "2.0"
  id: number
  method: typeof WS_RPC_METHOD | typeof WS_REPLY_METHOD
  params: unknown
}
export type ChannelResponse = { status: number; body: unknown }
export type WsServerResponse = { jsonrpc: "2.0"; id: number; result: ChannelResponse }
export type WsControl = "$/ping" | "$/pong" | "$/detach"

const frameSchema = type({ event: "string", "id?": "string", data: "string" })
const requestSchema = type({
  jsonrpc: "'2.0'",
  id: "number",
  method: type.enumerated(WS_RPC_METHOD, WS_REPLY_METHOD),
  params: "unknown",
})
const responseSchema = type({
  jsonrpc: "'2.0'",
  id: "number",
  result: { status: "number", body: "unknown" },
})
const controlSchema = type({
  jsonrpc: "'2.0'",
  method: "'$/ping' | '$/pong' | '$/detach'",
  "id?": "never",
})

type WsServerMessage =
  | { kind: "frame"; frame: ChannelFrame }
  | { kind: "response"; response: WsServerResponse }
  | { kind: "pong" }

type WsClientMessage =
  | { kind: "request"; request: WsClientRequest }
  | { kind: "ping" }
  | { kind: "detach" }

export function closeCodeForStatus(status: number): number {
  return 4000 + status
}

export function statusForCloseCode(code: number): number | undefined {
  return Number.isInteger(code) && code >= 4000 && code <= 4999 ? code - 4000 : undefined
}

export function encodeWsFrame(frame: ChannelFrame): string {
  return JSON.stringify(frame)
}

export function encodeWsServerResponse(id: number, result: ChannelResponse): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result } satisfies WsServerResponse)
}

export function encodeWsClientRequest(request: WsClientRequest): string {
  return JSON.stringify(request)
}

export function encodeWsControl(method: WsControl): string {
  return JSON.stringify({ jsonrpc: "2.0", method })
}

function parseMessage(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function decodeWsServerMessage(raw: string): WsServerMessage | null {
  const message = parseMessage(raw)
  const frame = frameSchema(message)
  if (!(frame instanceof type.errors)) return { kind: "frame", frame }
  const response = responseSchema(message)
  if (!(response instanceof type.errors)) return { kind: "response", response }
  const control = controlSchema(message)
  return !(control instanceof type.errors) && control.method === "$/pong" ? { kind: "pong" } : null
}

export function decodeWsClientMessage(raw: string): WsClientMessage | null {
  const message = parseMessage(raw)
  const request = requestSchema(message)
  if (!(request instanceof type.errors)) return { kind: "request", request }
  const control = controlSchema(message)
  if (control instanceof type.errors) return null
  switch (control.method) {
    case "$/ping":
      return { kind: "ping" }
    case "$/detach":
      return { kind: "detach" }
    default:
      return null
  }
}
