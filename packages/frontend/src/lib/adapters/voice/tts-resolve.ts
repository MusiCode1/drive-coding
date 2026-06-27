/**
 * tts-resolve.ts — מקור-אמת יחיד לבחירת ספק TTS.
 *
 * resolveTts(ttsProvider, voiceId) → { provider, voiceId, modelId }
 *
 * מקבל primitives (ttsProvider, voiceId) — לא את Settings VM (שכבות: adapter < VM).
 * "Kore" מרוכז כאן → V4b ישנה במקום יחיד.
 *
 * V4a-unify (Commit 0)
 */

import type { TtsProvider } from "@drive-coding/core/voice/tts-types"
import { elevenLabsTts } from "./tts"
import { geminiTts } from "./tts-gemini"

export interface ResolvedTts {
  provider: TtsProvider
  voiceId: string
  modelId: string
}

/** מקור-אמת יחיד: ספק TTS פעיל + voice + model לפי ההגדרה. "Kore" מתרכז כאן (→ V4b). */
export function resolveTts(
  ttsProvider: "elevenlabs" | "google",
  elevenVoiceId: string,
): ResolvedTts {
  if (ttsProvider === "google") {
    return { provider: geminiTts, voiceId: "Kore", modelId: "gemini-3.1-flash-tts-preview" }
  }
  return { provider: elevenLabsTts, voiceId: elevenVoiceId, modelId: "eleven_v3" }
}
