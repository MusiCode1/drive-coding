import { type } from "arktype"

// ─── Client → Server ─────────────────────────────────────────

export const PingMessage = type({ type: "'ping'" })
export type PingMessage = typeof PingMessage.infer

// Slice 4: prompt + cancel
export const PromptMessage = type({
  type: "'prompt'",
  text: "string >= 1",
})
export type PromptMessage = typeof PromptMessage.infer

export const CancelMessage = type({ type: "'cancel'" })
export type CancelMessage = typeof CancelMessage.infer

export const ClientMessage = PingMessage.or(PromptMessage).or(CancelMessage)
export type ClientMessage = typeof ClientMessage.infer

// ─── Server → Client ─────────────────────────────────────────

export const HelloMessage = type({ type: "'hello'", version: "string" })
export type HelloMessage = typeof HelloMessage.infer

export const PongMessage = type({
  type: "'pong'",
  echoOf: "string",
  serverTime: "number",
})
export type PongMessage = typeof PongMessage.infer

// Slice 4: rich server messages
export const ConnectedMessage = type({
  type: "'connected'",
  agentId: "string",
})
export type ConnectedMessage = typeof ConnectedMessage.infer

export const ThinkingMessage = type({
  type: "'thinking'",
})
export type ThinkingMessage = typeof ThinkingMessage.infer

export const TextChunkMessage = type({
  type: "'text_chunk'",
  kind: "'message' | 'thought'",
  text: "string",
})
export type TextChunkMessage = typeof TextChunkMessage.infer

export const ToolCallMessage = type({
  type: "'tool_call'",
  toolCallId: "string",
  title: "string",
})
export type ToolCallMessage = typeof ToolCallMessage.infer

export const DoneMessage = type({
  type: "'done'",
  stopReason: "string",
})
export type DoneMessage = typeof DoneMessage.infer

export const ErrorMessage = type({
  type: "'error'",
  code: "string",
  message: "string",
})
export type ErrorMessage = typeof ErrorMessage.infer

export const ServerMessage = HelloMessage.or(PongMessage)
  .or(ConnectedMessage)
  .or(ThinkingMessage)
  .or(TextChunkMessage)
  .or(ToolCallMessage)
  .or(DoneMessage)
  .or(ErrorMessage)

export type ServerMessage = typeof ServerMessage.infer
