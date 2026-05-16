import { elevenlabs } from "@ai-sdk/elevenlabs"
import { google } from "@ai-sdk/google"
import { geminiTranscription } from "./providers/gemini-transcription.js"

/**
 * STT registry — maps model key to TranscriptionModelV3.
 * Slice 5: only Gemini Flash with context support (D39).
 */
export const STT_REGISTRY = {
  "gemini/flash-context": geminiTranscription("gemini-2.0-flash"),
} as const

export type SttModelKey = keyof typeof STT_REGISTRY

/**
 * TTS registry — maps model key to SpeechModelV3.
 * Slice 5: ElevenLabs v3 (the only model supporting Hebrew via API — learning 2026-05-13).
 */
export const TTS_REGISTRY = {
  "elevenlabs/v3": elevenlabs.speech("eleven_v3"),
} as const

export type TtsModelKey = keyof typeof TTS_REGISTRY

/**
 * Translator registry — maps model key to LanguageModelV1.
 * Slice 5: Gemini Flash Lite for fast translation (D38).
 */
export const TRANSLATOR_REGISTRY = {
  "gemini/flash-lite": google("gemini-2.0-flash-lite"),
} as const

export type TranslatorModelKey = keyof typeof TRANSLATOR_REGISTRY

export type VoiceRegistries = {
  stt: typeof STT_REGISTRY
  tts: typeof TTS_REGISTRY
  translator: typeof TRANSLATOR_REGISTRY
}

export const DEFAULT_REGISTRIES: VoiceRegistries = {
  stt: STT_REGISTRY,
  tts: TTS_REGISTRY,
  translator: TRANSLATOR_REGISTRY,
}
