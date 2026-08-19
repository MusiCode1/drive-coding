/**
 * tts-types.ts — ממשקי TTS טהורים (type-only, ללא IO).
 *
 * AbortSignal ו-ReadableStream הם standard-lib (DOM+Node); AbortSignal כבר בשימוש
 * ב-core/async/with-timeout.ts. אין browser-global runtime כאן.
 */

/** רמת קצב-דיבור — גנרי; כל ספק מפרש (Gemini→Director's-Notes, ElevenLabs→מתעלם). */
export type SpeechPace = "very-slow" | "slow" | "normal" | "fast" | "very-fast"
/** טון-דיבור — גנרי; ר' SpeechPace. */
export type SpeechTone = "neutral" | "calm" | "energetic" | "formal" | "casual"
export interface SpeechDirecting {
  pace?: SpeechPace
  tone?: SpeechTone
}

export interface TtsRequest {
  text: string
  voiceId: string
  modelId?: string
  messageId?: string | null
  signal?: AbortSignal
  /** הנחיות-בימוי אופציונליות. ספקים שלא תומכים (ElevenLabs) מתעלמים. */
  directing?: SpeechDirecting
}

export interface TtsProvider {
  /** פורמט הפלט: "mp3" (ElevenLabs) או "pcm" (Gemini TTS, l16 24kHz). */
  format: "mp3" | "pcm"
  /** טקסט → זרם בייטים של אודיו. */
  synthesize(req: TtsRequest): Promise<ReadableStream<Uint8Array>>
}
