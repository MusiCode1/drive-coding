<script lang="ts">
/**
 * GeminiVoicePicker — בורר קול Gemini (רכיב leaf דק).
 *
 * מציג <Select> עם 30 קולות prebuilt של Gemini, כל אחד עם תיאור-אופי
 * דו-לשוני (דרך i18n). הרשימה סטטית — אין endpoint לקולות ב-Gemini API.
 *
 * אגנוסטי לפריסה: אב הרכיב עוטף אותו בתווית / מיכל מתאים.
 *
 * V4b (slice-V4b-gemini-voice-picker)
 */
import { getI18n, getSettings } from "$lib/context"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { GEMINI_VOICES } from "$lib/adapters/voice/voices-gemini"

const settings = getSettings()
const t = getI18n().t

// רשימת האפשרויות — סטטית, ללא async/effect
const voiceOptions: SelectOption[] = GEMINI_VOICES.map((v) => ({
  value: v.id,
  label: v.id,
  description: t(v.descKey),
}))
</script>

<Select
  value={settings.geminiVoice}
  options={voiceOptions}
  title={t("settings.geminiVoice.label")}
  ariaLabel={t("settings.geminiVoice.label")}
  onchange={(v) => settings.setGeminiVoice(v)}
/>
