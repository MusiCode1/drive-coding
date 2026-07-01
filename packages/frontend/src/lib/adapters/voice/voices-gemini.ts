/**
 * voices-gemini.ts — רשימת קולות prebuilt של Gemini TTS.
 *
 * מקור: https://ai.google.dev/gemini-api/docs/speech-generation (אומת 2026-06-29).
 * הרשימה סטטית — אין endpoint לקולות ב-Gemini API (אומת: /v1beta/voices=404,
 * @google/genai 2.3.0 ללא method, models.list ללא voices).
 *
 * V4b (slice-V4b-gemini-voice-picker)
 */

import type { MessageKey } from "@drive-coding/core/i18n"

export interface GeminiVoice {
  /** voiceName ל-prebuiltVoiceConfig (למשל "Kore"). data, אנגלית. */
  id: string
  /** מפתח i18n לתיאור-האופי הדו-לשוני. literal → תואם MessageKey (type-safe). */
  descKey: MessageKey
}

/** ברירת מחדל — זהה לקבוע שהיה ב-resolveTts לפני V4b. */
export const DEFAULT_GEMINI_VOICE = "Kore"

/**
 * 30 קולות prebuilt של Gemini TTS.
 * מקור: ai.google.dev/gemini-api/docs/speech-generation (אומת 2026-06-29).
 */
export const GEMINI_VOICES: readonly GeminiVoice[] = [
  { id: "Zephyr",         descKey: "settings.geminiVoice.desc.Zephyr" },
  { id: "Puck",           descKey: "settings.geminiVoice.desc.Puck" },
  { id: "Charon",         descKey: "settings.geminiVoice.desc.Charon" },
  { id: "Kore",           descKey: "settings.geminiVoice.desc.Kore" },
  { id: "Fenrir",         descKey: "settings.geminiVoice.desc.Fenrir" },
  { id: "Leda",           descKey: "settings.geminiVoice.desc.Leda" },
  { id: "Orus",           descKey: "settings.geminiVoice.desc.Orus" },
  { id: "Aoede",          descKey: "settings.geminiVoice.desc.Aoede" },
  { id: "Callirrhoe",     descKey: "settings.geminiVoice.desc.Callirrhoe" },
  { id: "Autonoe",        descKey: "settings.geminiVoice.desc.Autonoe" },
  { id: "Enceladus",      descKey: "settings.geminiVoice.desc.Enceladus" },
  { id: "Iapetus",        descKey: "settings.geminiVoice.desc.Iapetus" },
  { id: "Umbriel",        descKey: "settings.geminiVoice.desc.Umbriel" },
  { id: "Algieba",        descKey: "settings.geminiVoice.desc.Algieba" },
  { id: "Despina",        descKey: "settings.geminiVoice.desc.Despina" },
  { id: "Erinome",        descKey: "settings.geminiVoice.desc.Erinome" },
  { id: "Algenib",        descKey: "settings.geminiVoice.desc.Algenib" },
  { id: "Rasalgethi",     descKey: "settings.geminiVoice.desc.Rasalgethi" },
  { id: "Laomedeia",      descKey: "settings.geminiVoice.desc.Laomedeia" },
  { id: "Achernar",       descKey: "settings.geminiVoice.desc.Achernar" },
  { id: "Alnilam",        descKey: "settings.geminiVoice.desc.Alnilam" },
  { id: "Schedar",        descKey: "settings.geminiVoice.desc.Schedar" },
  { id: "Gacrux",         descKey: "settings.geminiVoice.desc.Gacrux" },
  { id: "Pulcherrima",    descKey: "settings.geminiVoice.desc.Pulcherrima" },
  { id: "Achird",         descKey: "settings.geminiVoice.desc.Achird" },
  { id: "Zubenelgenubi",  descKey: "settings.geminiVoice.desc.Zubenelgenubi" },
  { id: "Vindemiatrix",   descKey: "settings.geminiVoice.desc.Vindemiatrix" },
  { id: "Sadachbia",      descKey: "settings.geminiVoice.desc.Sadachbia" },
  { id: "Sadaltager",     descKey: "settings.geminiVoice.desc.Sadaltager" },
  { id: "Sulafat",        descKey: "settings.geminiVoice.desc.Sulafat" },
] as const
