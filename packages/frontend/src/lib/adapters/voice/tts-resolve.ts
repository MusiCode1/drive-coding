/**
 * tts-resolve.ts — מקור-אמת יחיד לבחירת ספק TTS.
 *
 * resolveTts(ttsProvider, elevenVoiceId, geminiVoice?, models?) → { provider, voiceId, modelId }
 *
 * מקבל primitives (ttsProvider, voiceId) — לא את Settings VM (שכבות: adapter < VM).
 * "Kore" מרוכז כאן → V4b הוסיף geminiVoice אופציונלי (ברירת מחדל DEFAULT_GEMINI_VOICE).
 *
 * V4a-unify (Commit 0) · V4b (Commit 0) · tts-model-choice
 */

import type { TtsProvider } from "@drive-coding/core/voice/tts-types"
import { elevenLabsTts } from "./tts"
import { geminiTts } from "./tts-gemini"
import { DEFAULT_GEMINI_VOICE } from "./voices-gemini"

export const DEFAULT_ELEVENLABS_TTS_MODEL = "eleven_v3" as const
export const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview" as const

export const ELEVENLABS_TTS_MODEL_IDS = ["eleven_v3", "eleven_v4", "eleven_v4_turbo"] as const
export const GEMINI_TTS_MODEL_IDS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
] as const

export type ElevenLabsTtsModelId = (typeof ELEVENLABS_TTS_MODEL_IDS)[number]
export type GeminiTtsModelId = (typeof GEMINI_TTS_MODEL_IDS)[number]

export interface TtsModelPreferences {
  elevenLabsModelId?: string
  geminiModelId?: string
}

export interface ResolvedTts {
  provider: TtsProvider
  voiceId: string
  modelId: string
}

export function normalizeElevenLabsModelId(id: string | undefined): ElevenLabsTtsModelId {
  if (id !== undefined && (ELEVENLABS_TTS_MODEL_IDS as readonly string[]).includes(id)) {
    return id as ElevenLabsTtsModelId
  }
  return DEFAULT_ELEVENLABS_TTS_MODEL
}

export function normalizeGeminiModelId(id: string | undefined): GeminiTtsModelId {
  if (id !== undefined && (GEMINI_TTS_MODEL_IDS as readonly string[]).includes(id)) {
    return id as GeminiTtsModelId
  }
  return DEFAULT_GEMINI_TTS_MODEL
}

export function isGemini38TtsModel(modelId: string): boolean {
  return modelId === "gemini-3.8-flash-tts" || modelId === "gemini-3.8-flash-lite-tts"
}

/**
 * מקור-אמת יחיד: ספק TTS פעיל + voice + model לפי ההגדרה.
 * @param ttsProvider - הספק הנבחר
 * @param elevenVoiceId - קול ElevenLabs (מוחזר כמות שהוא לספק ElevenLabs)
 * @param geminiVoice - קול Gemini (אופציונלי; ברירת מחדל DEFAULT_GEMINI_VOICE="Kore")
 * @param models - העדפות מודל לכל ספק (לא מוכר → fallback לברירת-מחדל של אותו ספק)
 */
export function resolveTts(
  ttsProvider: "elevenlabs" | "google",
  elevenVoiceId: string,
  geminiVoice?: string,
  models?: TtsModelPreferences,
): ResolvedTts {
  if (ttsProvider === "google") {
    return {
      provider: geminiTts,
      voiceId: geminiVoice ?? DEFAULT_GEMINI_VOICE,
      modelId: normalizeGeminiModelId(models?.geminiModelId),
    }
  }
  return {
    provider: elevenLabsTts,
    voiceId: elevenVoiceId,
    modelId: normalizeElevenLabsModelId(models?.elevenLabsModelId),
  }
}
