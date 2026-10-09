/**
 * tts-speech-options.ts — SelectOption builders for voice & speech settings card.
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import type { ProviderCapabilities } from "$lib/adapters/tts-capabilities"
import { ELEVENLABS_TTS_MODEL_IDS, GEMINI_TTS_MODEL_IDS } from "$lib/adapters/voice/tts-resolve"
import type { SelectOption } from "$lib/components/ui/Select.svelte"
import { ttsReasonMessage } from "$lib/util/tts-reason"

const ELEVEN_MODEL_LABEL_KEYS: Record<(typeof ELEVENLABS_TTS_MODEL_IDS)[number], MessageKey> = {
  eleven_v3: "settings.ttsModel.eleven_v3",
  eleven_v4: "settings.ttsModel.eleven_v4",
  eleven_v4_turbo: "settings.ttsModel.eleven_v4_turbo",
}

const GEMINI_MODEL_LABEL_KEYS: Record<(typeof GEMINI_TTS_MODEL_IDS)[number], MessageKey> = {
  "gemini-3.1-flash-tts-preview": "settings.ttsModel.gemini_3_1_flash_tts_preview",
  "gemini-3.8-flash-tts": "settings.ttsModel.gemini_3_8_flash_tts",
  "gemini-3.8-flash-lite-tts": "settings.ttsModel.gemini_3_8_flash_lite_tts",
}

export function buildTtsProviderOptions(
  t: (key: MessageKey) => string,
  caps: ProviderCapabilities | undefined,
): SelectOption[] {
  return [
    {
      value: "elevenlabs",
      label: t("settings.ttsProvider.elevenlabs"),
      disabled: caps?.["elevenlabs"]?.available === false,
      description:
        caps?.["elevenlabs"]?.available === false
          ? ttsReasonMessage(caps["elevenlabs"].reason, t)
          : undefined,
    },
    {
      value: "google",
      label: t("settings.ttsProvider.gemini"),
      disabled: caps?.["google"]?.available === false,
      description:
        caps?.["google"]?.available === false
          ? ttsReasonMessage(caps["google"].reason, t)
          : undefined,
    },
  ]
}

export function buildElevenLabsModelOptions(t: (key: MessageKey) => string): SelectOption[] {
  return ELEVENLABS_TTS_MODEL_IDS.map((id) => ({
    value: id,
    label: t(ELEVEN_MODEL_LABEL_KEYS[id]),
  }))
}

export function buildGeminiModelOptions(t: (key: MessageKey) => string): SelectOption[] {
  return GEMINI_TTS_MODEL_IDS.map((id) => ({
    value: id,
    label: t(GEMINI_MODEL_LABEL_KEYS[id]),
  }))
}

/** When the selected provider is unavailable, switch to the other if possible. */
export function applyTtsProviderFallback(
  caps: ProviderCapabilities | undefined,
  current: "elevenlabs" | "google",
  setTtsProvider: (p: "elevenlabs" | "google") => void,
): void {
  if (!caps || caps[current]?.available !== false) return
  const fallback = (Object.keys(caps) as Array<"elevenlabs" | "google">).find(
    (p) => caps[p]?.available !== false,
  )
  if (fallback) setTtsProvider(fallback)
}
