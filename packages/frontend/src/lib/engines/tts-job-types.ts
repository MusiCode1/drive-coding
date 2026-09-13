import type { AudioEmbedRef } from "@drive-coding/core/voice/audio-embed"
import type { OrderKey } from "@drive-coding/core/voice/tts-queue"

export type TtsJobStatus = "pending" | "fetching" | "ready" | "error" | "stale"

export type FetchOutcome =
  | { kind: "ready" }
  | { kind: "abandoned" }
  | { kind: "error"; reason: "narration-null" | "provider-unavailable" | "synthesize-failed" }

export type TtsJob = {
  segmentId: string
  kind: "message" | "thought" | "tool" | "file"
  messageId: string | null
  text: string
  status: TtsJobStatus
  abort: AbortController
  bubbleId?: string
  orderKey: OrderKey
  toolCallId?: string
  file?: AudioEmbedRef
}
