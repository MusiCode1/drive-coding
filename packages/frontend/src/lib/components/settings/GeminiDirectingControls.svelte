<script lang="ts">
/**
 * GeminiDirectingControls — שני בוררים ספציפיים-ל-Gemini: קצב-דיבור וטון.
 *
 * מתורגמים מאחורי הקלעים ל-"Director's Notes" שמוזרקות לראש הפרומפט ל-Gemini TTS
 * (ר' packages/frontend/src/lib/adapters/voice/gemini-directing.ts). ElevenLabs לא
 * מושפע — לכן הקומפוננטה הזו רק מוצגת כש-settings.ttsProvider === "google"
 * (gating ב-SettingsScreen, כמו GeminiVoicePicker).
 *
 * קובץ ספציפי-לספק — אם יתברר אוניברסלי בעתיד, נוציא.
 *
 * slice-gemini-tts-directing
 */
import type { SpeechPace, SpeechTone } from "@drive-coding/core/voice/tts-types"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getI18n, getSettings } from "$lib/context"

const settings = getSettings()
const t = getI18n().t

const paceOptions: SelectOption[] = [
  { value: "very-slow", label: t("settings.geminiPace.verySlow") },
  { value: "slow", label: t("settings.geminiPace.slow") },
  { value: "normal", label: t("settings.geminiPace.normal") },
  { value: "fast", label: t("settings.geminiPace.fast") },
  { value: "very-fast", label: t("settings.geminiPace.veryFast") },
]

const toneOptions: SelectOption[] = [
  { value: "neutral", label: t("settings.geminiTone.neutral") },
  { value: "calm", label: t("settings.geminiTone.calm") },
  { value: "energetic", label: t("settings.geminiTone.energetic") },
  { value: "formal", label: t("settings.geminiTone.formal") },
  { value: "casual", label: t("settings.geminiTone.casual") },
]
</script>

<label class="flex flex-col gap-1.5">
  <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.geminiPace.label")}</span>
  <Select
    value={settings.geminiPace}
    options={paceOptions}
    title={t("settings.geminiPace.label")}
    ariaLabel={t("settings.geminiPace.label")}
    onchange={(v) => settings.setGeminiPace(v as SpeechPace)}
  />
</label>

<label class="flex flex-col gap-1.5">
  <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.geminiTone.label")}</span>
  <Select
    value={settings.geminiTone}
    options={toneOptions}
    title={t("settings.geminiTone.label")}
    ariaLabel={t("settings.geminiTone.label")}
    onchange={(v) => settings.setGeminiTone(v as SpeechTone)}
  />
</label>
