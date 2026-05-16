import type { CacheStore } from "@drive-coding/core"
import { cacheKeyFor } from "@drive-coding/core/voice/cache-key"
import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import { buildTranslationPrompt } from "@drive-coding/core/voice/translation-prompt"
import {
  experimental_generateSpeech as generateSpeech,
  generateText,
  experimental_transcribe as transcribe,
} from "ai"
import type { Result } from "neverthrow"
import { err, ok } from "neverthrow"
import type { VoiceRegistries } from "./providers.js"

export interface VoiceConfig {
  /** Key in STT_REGISTRY */
  sttModel: string
  /** Key in TTS_REGISTRY */
  ttsModel: string
  /** ElevenLabs voice ID (e.g. "Rachel", "Adam", or a custom voice UUID) */
  ttsVoiceId: string
  /** Key in TRANSLATOR_REGISTRY */
  translatorModel: string
  /** Target language for translation */
  targetLang: "he" | "en"
  /** Last assistant response, for STT context (D39) */
  previousAssistantText?: string
}

export interface VoiceCallbacks {
  onSttPartial: (text: string) => void
  onAudioChunk: (mp3Base64: string) => void
  onTranslation?: (original: string, translated: string) => void
  onError: (msg: string) => void
}

/**
 * Transcribes user audio using the configured STT model.
 * Returns Result<transcribed text, error string>.
 */
export async function transcribeUserAudio(
  audio: { bytes: Uint8Array; mimeType: string },
  config: VoiceConfig,
  registries: Pick<VoiceRegistries, "stt">,
): Promise<Result<string, string>> {
  const model = registries.stt[config.sttModel as keyof typeof registries.stt]
  if (!model) return err(`Unknown STT model: ${config.sttModel}`)

  try {
    const result = await transcribe({
      model,
      audio: audio.bytes,
      providerOptions: config.previousAssistantText
        ? { gemini: { previousAssistantText: config.previousAssistantText } }
        : undefined,
    })
    return ok(result.text)
  } catch (e: unknown) {
    return err(`STT failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Synthesizes a sentence to audio using the configured TTS model.
 * Checks disk cache first. On cache miss, calls TTS API and stores result.
 * Calls onChunk with the mp3 base64 once ready.
 */
export async function speakSentence(
  text: string,
  config: VoiceConfig,
  registries: Pick<VoiceRegistries, "tts">,
  cache: CacheStore,
  onChunk: (mp3Base64: string) => void,
): Promise<Result<void, string>> {
  const model = registries.tts[config.ttsModel as keyof typeof registries.tts]
  if (!model) return err(`Unknown TTS model: ${config.ttsModel}`)

  // TTS-2: voice ID is required — missing env var means TTS would silently fail with a 401
  if (!config.ttsVoiceId) {
    return err("TTS voice ID is not configured (ELEVENLABS_VOICE_ID missing)")
  }

  const key = await cacheKeyFor(text, config.ttsVoiceId, config.ttsModel)
  const cached = await cache.get(key)
  if (cached) {
    onChunk(Buffer.from(cached).toString("base64"))
    return ok(undefined)
  }

  try {
    const result = await generateSpeech({
      model,
      text,
      voice: config.ttsVoiceId,
    })
    const mp3Bytes = result.audio.uint8Array
    await cache.set(key, mp3Bytes)
    onChunk(Buffer.from(mp3Bytes).toString("base64"))
    return ok(undefined)
  } catch (e: unknown) {
    return err(`TTS failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** GEMINI-3: default timeout for translation requests (ms). */
const TRANSLATE_TIMEOUT_MS = 2500

/**
 * Translates text to the target language using Gemini Flash.
 * GEMINI-3: times out after TRANSLATE_TIMEOUT_MS (2500ms) to avoid blocking the audio pipeline.
 * On timeout or any error → returns Err; the caller decides whether to skip or retry.
 * Slice 5: always translates (language detection is future work).
 */
export async function translateText(
  text: string,
  config: VoiceConfig,
  registries: Pick<VoiceRegistries, "translator">,
  timeoutMs = TRANSLATE_TIMEOUT_MS,
): Promise<Result<string, string>> {
  const model = registries.translator[config.translatorModel as keyof typeof registries.translator]
  if (!model) return err(`Unknown translator model: ${config.translatorModel}`)

  try {
    const translatePromise = generateText({
      model,
      prompt: buildTranslationPrompt(text, config.targetLang),
    })
    // GEMINI-3: race against timeout — a hung Gemini call blocks the audio pipeline
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Translation timeout after ${timeoutMs}ms`)), timeoutMs),
    )
    const { text: translated } = await Promise.race([translatePromise, timeoutPromise])
    return ok(translated.trim())
  } catch (e: unknown) {
    return err(`Translation failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// Re-export splitIntoSentences so callers don't need to import from core directly
export { splitIntoSentences }
