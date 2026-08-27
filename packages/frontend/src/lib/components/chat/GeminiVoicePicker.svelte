<script lang="ts">
/**
 * GeminiVoicePicker — בורר קול Gemini (רכיב leaf דק).
 *
 * מציג <Select> עם 30 קולות prebuilt של Gemini. ברירת מחדל: settings.geminiVoice (TTS).
 * עם value/onchange — לשימוש ב-Live (settings.liveVoice) ובמקומות אחרים.
 *
 * V4b · live-voice-picker (props אופציונליים)
 */
import type { MessageKey } from "@drive-coding/core/i18n"
import { getI18n, getSettings } from "$lib/context"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { GEMINI_VOICES } from "$lib/adapters/voice/voices-gemini"

let {
  value,
  onchange,
  disabled = false,
  labelKey = "settings.geminiVoice.label" as MessageKey,
}: {
  value?: string
  onchange?: (v: string) => void
  disabled?: boolean
  labelKey?: MessageKey
} = $props()

const settings = getSettings()
const t = getI18n().t

const voiceOptions: SelectOption[] = GEMINI_VOICES.map((v) => ({
  value: v.id,
  label: v.id,
  description: t(v.descKey),
}))

const resolvedValue = $derived(value ?? settings.geminiVoice)

function onPick(v: string): void {
  if (onchange) onchange(v)
  else settings.setGeminiVoice(v)
}
</script>

<Select
  value={resolvedValue}
  options={voiceOptions}
  title={t(labelKey)}
  ariaLabel={t(labelKey)}
  {disabled}
  onchange={onPick}
/>
