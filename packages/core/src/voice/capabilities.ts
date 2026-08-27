/**
 * capabilities.ts — schemas ו-types של בחירת-ספק-קול (voice-provider selection).
 *
 * Slice V1: תשתית טהורה (pure, אין IO). מגדיר:
 *   - VoiceProvider: ספקים ידועים ("google" | "openai" | "elevenlabs")
 *   - VoiceModelRef: זוג (provider, model) — שמסורת לכל קריאת SDK
 *   - VoiceService: השירותים הידועים ("translate" | "narrate" | "stt" | "tts")
 *   - VoiceConfig: מיפוי service → VoiceModelRef
 *   - DEFAULT_VOICE_CONFIG: ערכי-ברירת-מחדל = המודלים הקשיחים היום (zero-behavior-change)
 *
 * V2 יוסיף provider-branch ב-translate/narrate. V3 יוסיף wiring ל-tts.
 * V4 יוסיף ספקי TTS נוספים. V1 = רק פותח את ה-seam.
 */
import { type } from "arktype"

export const voiceProvider = type("'google' | 'openai' | 'elevenlabs'")
export type VoiceProvider = typeof voiceProvider.infer

export const voiceModelRef = type({ provider: voiceProvider, model: "string" })
export type VoiceModelRef = typeof voiceModelRef.infer

export const voiceService = type("'translate' | 'narrate' | 'stt' | 'tts' | 'live'")
export type VoiceService = typeof voiceService.infer

export const voiceConfig = type({
  translate: voiceModelRef,
  narrate: voiceModelRef,
  stt: voiceModelRef,
  tts: voiceModelRef,
  live: voiceModelRef,
})
export type VoiceConfig = typeof voiceConfig.infer

/**
 * ברירות-מחדל = בדיוק המודלים הקשיחים שנמצאים היום בקוד (zero-behavior-change).
 * אל תשנה ערכים אלה — שינוי = באג של הסבב.
 *
 * translate/narrate: gemini-flash-lite-latest (ב-translate.ts:89, narrate.ts:42)
 * stt: gemini-flash-latest (ב-transcribe.ts:58)
 * tts: eleven_v3 (ב-tts.ts:31)
 */
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  translate: { provider: "google", model: "gemini-flash-lite-latest" },
  narrate:   { provider: "google", model: "gemini-flash-lite-latest" },
  stt:       { provider: "google", model: "gemini-flash-latest" },    // לא נצרך ב-V1 (V2)
  tts:       { provider: "elevenlabs", model: "eleven_v3" },           // לא נצרך ב-V1 (V3)
  live:      { provider: "google", model: "gemini-3.1-flash-live-preview" },
}
