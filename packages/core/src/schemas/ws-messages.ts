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

// Slice 5: audio voice message
export const AudioMessage = type({
  type: "'audio'",
  agentId: "string",
  audioBase64: "string",
  mimeType: "string",
})
export type AudioMessage = typeof AudioMessage.infer

export const ClientMessage = PingMessage.or(PromptMessage).or(CancelMessage).or(AudioMessage)
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

/**
 * Text chunk from ACP — streamed incrementally.
 *
 * Tier 1 additions (Phase 4):
 *   messageId — UUID stable across all chunks of the same message/thought turn.
 *     Allows frontend to group bubbles and link audio_chunks back to their source.
 */
export const TextChunkMessage = type({
  type: "'text_chunk'",
  kind: "'message' | 'thought'",
  text: "string",
  "messageId?": "string",
})
export type TextChunkMessage = typeof TextChunkMessage.infer

/**
 * Tool call notification. Sent on initial `tool_call` event AND on every
 * `tool_call_update` — frontend uses `toolCallId` to merge into a single
 * UI element (status badge, content section).
 *
 * `kind`: ACP ToolKind = "read" | "edit" | "delete" | "move" | "search" |
 *   "execute" | "think" | "fetch" | "switch_mode" | "other"
 * `status`: ACP ToolCallStatus = "pending" | "in_progress" | "completed" | "failed"
 * `locations`: array of file paths (for "follow-along" UI)
 * `content`: human-readable preview of tool output (text only — diff/terminal
 *   are summarised to a single line for Slice 5.5; richer rendering in Slice 7)
 *
 * Tier 1 additions (Phase 4):
 *   narration — Hebrew sentence describing the tool action (populated later via
 *     tool_call_update after narrateToolCall resolves).
 */
export const ToolCallMessage = type({
  type: "'tool_call'",
  toolCallId: "string",
  title: "string",
  "kind?": "string",
  "status?": "string",
  "locations?": "string[]",
  "content?": "string",
  "narration?": "string",
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

// Slice 5: voice server messages
export const SttPartialMessage = type({
  type: "'stt_partial'",
  text: "string",
})
export type SttPartialMessage = typeof SttPartialMessage.infer

/**
 * Audio chunk from TTS.
 *
 * Tier 1 additions (Phase 4):
 *   segmentId — unique UUID per TTS segment (one sentence = one segment).
 *   messageId — parent message/thought ID (links segment back to text_chunk).
 *   kind — "message" | "thought" | "narration".
 *   originalText — source English text before translation.
 *   translatedText — Hebrew text that was synthesised.
 */
export const AudioChunkMessage = type({
  type: "'audio_chunk'",
  mp3Base64: "string",
  "segmentId?": "string",
  "messageId?": "string",
  "kind?": "'message' | 'thought' | 'narration'",
  "originalText?": "string",
  "translatedText?": "string",
})
export type AudioChunkMessage = typeof AudioChunkMessage.infer

export const TranslationMessage = type({
  type: "'translation'",
  original: "string",
  translated: "string",
})
export type TranslationMessage = typeof TranslationMessage.infer

/**
 * Sent after narrateToolCall resolves — updates the tool card with a
 * natural Hebrew narration of what the agent is doing.
 * Tier 1 (Phase 4): new event.
 */
export const ToolCallUpdateMessage = type({
  type: "'tool_call_update'",
  toolCallId: "string",
  narration: "string",
})
export type ToolCallUpdateMessage = typeof ToolCallUpdateMessage.infer

export const ServerMessage = HelloMessage.or(PongMessage)
  .or(ConnectedMessage)
  .or(ThinkingMessage)
  .or(TextChunkMessage)
  .or(ToolCallMessage)
  .or(ToolCallUpdateMessage)
  .or(DoneMessage)
  .or(ErrorMessage)
  .or(SttPartialMessage)
  .or(AudioChunkMessage)
  .or(TranslationMessage)

export type ServerMessage = typeof ServerMessage.infer
