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
  /** פורמט הפלט: "mp3" (ElevenLabs) או "pcm" (Gemini TTS, l16 24kHz). */
  format: "mp3" | "pcm"
  /** טקסט → זרם בייטים של אודיו. */
  synthesize(req: TtsRequest): Promise<ReadableStream<Uint8Array>>
}
