/**
 * live-types.ts — provider-agnostic realtime voice contract (type-only).
 *
 * Slice: live-contract-gemini, Commit 0.
 * No runtime, no browser globals.
 */

export type LiveEvent =
  | { type: "session_started" }
  | { type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { type: "audio"; pcm: Uint8Array }
  | { type: "action"; id: string; name: string; args: Record<string, unknown> }
  | { type: "interrupted" }
  | { type: "turn_done"; role: "user" | "assistant" }
  | { type: "usage"; totalTokens: number; promptTokens: number }
  | { type: "error"; message: string }
  | { type: "closed"; reason?: string }

export type LiveCommand =
  | { type: "audio"; pcm: Uint8Array }
  | { type: "audio_stream_end" }
  | { type: "context"; text: string; channel: "speakable" | "silent" }
  | { type: "action_result"; id: string; name: string; result: unknown }
  | { type: "close" }

export interface LiveConnectOpts {
  /** Atomic credential the adapter interprets. Gemini: one-time token from BE. */
  credential: string
  model: string
  /**
   * Session config as built by BE — opaque to core.
   * Adapter passes verbatim to live.connect; must not mutate.
   */
  providerConfig: Readonly<Record<string, unknown>>
  /**
   * Optional cap on how long `connect()` may stay pending.
   *
   * The contract is that `connect()` ALWAYS settles: it resolves on a ready
   * session and rejects on a session that never becomes ready. A provider whose
   * transport can fail silently must not leave the caller waiting — the caller
   * is a hands-free user with no way to cancel.
   */
  connectTimeoutMs?: number
  onEvent: (event: LiveEvent) => void
}

export interface LiveSession {
  send(command: LiveCommand): void
  close(): void
}

export interface LiveProvider {
  readonly id: string
  readonly inputSampleRate: number
  readonly outputSampleRate: number
  readonly supportsSilentContext: boolean
  connect(opts: LiveConnectOpts): Promise<LiveSession>
}
