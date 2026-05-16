import { createElevenLabs } from "@ai-sdk/elevenlabs"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { geminiTranscription } from "./providers/gemini-transcription.js"

/**
 * Placeholder API keys.
 *
 * The SDKs (`@ai-sdk/elevenlabs`, `@ai-sdk/google`) check for an API key at
 * construction time and fail-fast if missing. They send the key as HTTP header
 * (`xi-api-key`, `x-goog-api-key`). In our runtime, OneCLI's proxy gateway
 * intercepts outbound requests to the matching host and **replaces** the
 * header value with the real secret. So a placeholder is sufficient — the
 * real value never lives in our process memory.
 *
 * If OneCLI is NOT in the request path (e.g. unit tests), the placeholder
 * causes a 401 from the upstream API, which is the desired behaviour.
 *
 * See learning 2026-05-14 (OneCLI selective agent) and learning 2026-05-13
 * (ElevenLabs v3 is the only Hebrew-capable model).
 */
const PLACEHOLDER_KEY = "onecli-injects-this-at-proxy"

const elevenlabs = createElevenLabs({ apiKey: PLACEHOLDER_KEY })
const google = createGoogleGenerativeAI({ apiKey: PLACEHOLDER_KEY })

/**
 * STT registry — maps model key to TranscriptionModelV3.
 * Slice 5: only Gemini Flash with context support (D39).
 */
export const STT_REGISTRY = {
  "gemini/flash-context": geminiTranscription("gemini-flash-latest"),
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
  "gemini/flash-lite": google("gemini-flash-lite-latest"),
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
