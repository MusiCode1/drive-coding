/**
 * tts-resolve.ts — מקור-אמת יחיד לבחירת ספק TTS.
 *
 * resolveTts(ttsProvider, elevenVoiceId, geminiVoice?) → { provider, voiceId, modelId }
 *
 * מקבל primitives (ttsProvider, voiceId) — לא את Settings VM (שכבות: adapter < VM).
 * "Kore" מרוכז כאן → V4b הוסיף geminiVoice אופציונלי (ברירת מחדל DEFAULT_GEMINI_VOICE).
 *
 * V4a-unify (Commit 0) · V4b (Commit 0)
 */

import type { TtsProvider } from "@drive-coding/core/voice/tts-types"
import { elevenLabsTts } from "./tts"
import { geminiTts } from "./tts-gemini"
import { DEFAULT_GEMINI_VOICE } from "./voices-gemini"

export interface ResolvedTts {
  provider: TtsProvider
  voiceId: string
  modelId: string
}

/**
 * מקור-אמת יחיד: ספק TTS פעיל + voice + model לפי ההגדרה.
 * @param ttsProvider - הספק הנבחר
 * @param elevenVoiceId - קול ElevenLabs (מוחזר כמות שהוא לספק ElevenLabs)
 * @param geminiVoice - קול Gemini (אופציונלי; ברירת מחדל DEFAULT_GEMINI_VOICE="Kore")
 */
export function resolveTts(
  ttsProvider: "elevenlabs" | "google",
  elevenVoiceId: string,
  geminiVoice?: string,
): ResolvedTts {
  if (ttsProvider === "google") {
    return {
      provider: geminiTts,
      voiceId: geminiVoice ?? DEFAULT_GEMINI_VOICE,
      modelId: "gemini-3.1-flash-tts-preview",
    }
  }
  return { provider: elevenLabsTts, voiceId: elevenVoiceId, modelId: "eleven_v3" }
}
