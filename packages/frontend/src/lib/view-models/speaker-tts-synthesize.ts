/**
 * speaker-tts-synthesize.ts — resolve + synthesize TTS for a Speaker segment job.
 *
 * tts-model-choice: חילוץ מ-speaker.svelte.ts (#fetchJob) לכיווץ ratchet.
 */

import { cacheKeyFor } from "@drive-coding/core/voice/cache-key"
import type { SpeechPace, SpeechTone, TtsProvider } from "@drive-coding/core/voice/tts-types"
import { resolveTts, type TtsModelPreferences } from "../adapters/voice/tts-resolve"
import { ttsCapabilities } from "./capabilities.svelte"

export type SpeakerTtsSynthInput = {
  ttsProvider: "elevenlabs" | "google"
  voiceId: string
  geminiVoice: string
  models: TtsModelPreferences
  geminiPace: SpeechPace
  geminiTone: SpeechTone
  text: string
  messageId: string | null
  signal: AbortSignal
}

export type SpeakerTtsSynthResult =
  | {
      ok: true
      stream: ReadableStream<Uint8Array>
      provider: TtsProvider
      textHash: string
      format: TtsProvider["format"]
    }
  | { ok: false; reason: "provider-unavailable" }

export async function synthesizeSpeakerSegment(
  input: SpeakerTtsSynthInput,
): Promise<SpeakerTtsSynthResult> {
  const { provider, voiceId, modelId } = resolveTts(
    input.ttsProvider,
    input.voiceId,
    input.geminiVoice,
    input.models,
  )
  if (!ttsCapabilities.isAvailable(input.ttsProvider)) {
    return { ok: false, reason: "provider-unavailable" }
  }
  const textHash = await cacheKeyFor(input.text, voiceId, modelId)
  const stream = await provider.synthesize({
    text: input.text,
    voiceId,
    modelId,
    messageId: input.messageId,
    signal: input.signal,
    directing: { pace: input.geminiPace, tone: input.geminiTone },
  })
  return { ok: true, stream, provider, textHash, format: provider.format }
}
