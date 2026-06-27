/**
 * tts-types.ts — ממשקי TTS טהורים (type-only, ללא IO).
 *
 * AbortSignal ו-ReadableStream הם standard-lib (DOM+Node); AbortSignal כבר בשימוש
 * ב-core/async/with-timeout.ts. אין browser-global runtime כאן.
 */

export interface TtsRequest {
  text: string
  voiceId: string
  modelId?: string
  messageId?: string | null
  signal?: AbortSignal
}

export interface TtsProvider {
  /** טקסט → זרם בייטים של אודיו (היום: MP3 מ-ElevenLabs). */
  synthesize(req: TtsRequest): Promise<ReadableStream<Uint8Array>>
}
