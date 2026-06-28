<script lang="ts">
/**
 * SettingsScreen — מסך הגדרות.
 *
 * כרטיסים:
 *  1. "קול ודיבור" — VoicePicker + TTS provider Select + toggles
 *  2. "שרת" — beUrl
 *
 * הוסר (redesign-fix): כרטיס "חיבור" (תיקייה/מודל/session) — כל הבוררים האלה
 * זמינים מחוץ ל-Settings (דף החיבור / SessionOptionsPanel), כך שהם מיותרים כאן.
 *
 * כפתורי איפוס ושמור.
 *
 * ─── settings-redesign (redesign-3) · redesign-fix · V4a (TTS provider) ───
 */
import { version } from "$app/environment"
import { goto } from "$app/navigation"
import VoicePicker from "$lib/components/chat/VoicePicker.svelte"
import GeminiVoicePicker from "$lib/components/chat/GeminiVoicePicker.svelte"
import { getI18n, getSettings } from "$lib/context"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import LanguageSelect from "./LanguageSelect.svelte"
import PalettePicker from "./PalettePicker.svelte"
import SettingsCard from "./SettingsCard.svelte"
import SettingToggle from "./SettingToggle.svelte"

const settings = getSettings()
const t = getI18n().t

// translateThoughts disabled כש-speakThoughts כבוי
const translateDisabled = $derived(!settings.speakThoughts)

// ─── TTS provider ─── (V4a)
const ttsProviderOptions = $derived<SelectOption[]>([
  { value: "elevenlabs", label: t("settings.ttsProvider.elevenlabs") },
  { value: "google", label: t("settings.ttsProvider.gemini") },
])

// כיבוי הקראת מחשבות מכבה גם את תרגום המחשבות (לא נשאר דלוק-לא-זמין)
function onSpeakThoughtsChange(v: boolean) {
  settings.setSpeakThoughts(v)
  if (!v) settings.setTranslateThoughts(false)
}

// ─── beUrl ─── (הוחזר אחרי ה-redesign — ה-VM קיים, רק ה-UI נשמט)
// טופס מבוקר: ערך הקלט נפרד מ-settings.beUrl, נשמר רק על blur/Enter דרך
// setBeUrl (שמחזיר Result). beUrlStatus משקף ולידציה/שמירה להצגה בלבד.
let beUrlInput = $state(settings.beUrl)
let beUrlStatus = $state<{ kind: "idle" | "saved" | "error"; msg?: string }>({ kind: "idle" })

function commitBeUrl() {
  const res = settings.setBeUrl(beUrlInput)
  if (res.ok) {
    // מנרמל את הקלט לערך שנשמר בפועל (trim + הסרת / מסיים)
    beUrlInput = settings.beUrl
    beUrlStatus = { kind: "saved" }
  } else {
    beUrlStatus = { kind: "error", msg: res.error }
  }
}

// F1: "נשמר ✓" נעלם אחרי 3s. דפוס מ-67694fb — $effect שמגיב ל-beUrlStatus,
// ה-cleanup מבטל timer קודם (שמירה חוזרת) ומנקה ב-teardown (מניעת set אחרי unmount).
$effect(() => {
  if (beUrlStatus.kind !== "saved") return
  const timer = setTimeout(() => {
    beUrlStatus = { kind: "idle" }
  }, 3000)
  return () => clearTimeout(timer)
})
</script>

<section
  class="flex flex-col flex-1 min-h-0 overflow-y-auto chat-scroll px-4 pt-20 pb-8 w-full max-w-2xl mx-auto"
>
  <h1 class="text-xl font-semibold mb-1">{t("settings.title")}</h1>

  <!-- כרטיס שפת ממשק — (rtl-ltr-bidi) -->
  <SettingsCard title={t("settings.language.label")}>
    <LanguageSelect />
  </SettingsCard>

  <!-- כרטיס ערכת נושא — (palettes-expansion) -->
  <SettingsCard title={t("settings.theme.label")}>
    <PalettePicker />
  </SettingsCard>

  <!-- כרטיס קול ודיבור -->
  <SettingsCard title={t("settings.voiceSpeech")}>
    <!-- Voice picker -->
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.voice.label")}</span>
      <VoicePicker />
    </label>

    <!-- TTS provider selector — (V4a) -->
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.ttsProvider.label")}</span>
      <Select
        options={ttsProviderOptions}
        value={settings.ttsProvider}
        title={t("settings.ttsProvider.label")}
        onchange={(v) => settings.setTtsProvider(v as "elevenlabs" | "google")}
      />
    </label>

    <!-- בורר קול Gemini — conditional (V4b) -->
    {#if settings.ttsProvider === "google"}
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.geminiVoice.label")}</span>
        <GeminiVoicePicker />
      </label>
    {/if}

    <!-- toggles — מוקאפ שורות 626-643 -->
    <div class="flex flex-col divide-y" style="border-color:var(--border)">
      <SettingToggle
        label={t("settings.toggle.speakThoughts")}
        checked={settings.speakThoughts}
        onCheckedChange={onSpeakThoughtsChange}
      />
      <SettingToggle
        label={t("settings.toggle.narrateTools")}
        checked={settings.narrateTools}
        onCheckedChange={(v) => settings.setNarrateTools(v)}
      />
      <SettingToggle
        label={t("settings.toggle.translateThoughts")}
        checked={settings.translateThoughts}
        onCheckedChange={(v) => settings.setTranslateThoughts(v)}
        disabled={translateDisabled}
      />
      <!-- מצב רכב — מושבת זמנית (לא מחווט עדיין, slice 7) -->
      <SettingToggle
        label={t("settings.toggle.carMode")}
        checked={settings.carMode}
        onCheckedChange={(v) => settings.setCarMode(v)}
        disabled
      />
    </div>
  </SettingsCard>

  <!-- כרטיס מסך — wake-lock (slice-wake-lock) -->
  <SettingsCard title={t("settings.screen.label")}>
    <SettingToggle
      label={t("settings.toggle.keepScreenOn")}
      checked={settings.screenWakeLock}
      onCheckedChange={(v) => settings.setScreenWakeLock(v)}
    />
  </SettingsCard>

  <!-- כרטיס תצוגת צ'אט — display-toggle-consistency -->
  <SettingsCard title={t("settings.chatDisplay")}>
    <div class="flex flex-col">
      <SettingToggle
        label={t("settings.toggle.showThoughts")}
        checked={settings.showThoughts}
        onCheckedChange={(v) => settings.setShowThoughts(v)}
      />
      <SettingToggle
        label={t("settings.toggle.showTools")}
        checked={settings.showTools}
        onCheckedChange={(v) => settings.setShowTools(v)}
      />
      <SettingToggle
        label={t("settings.toggle.enterToSend")}
        checked={settings.enterToSend}
        onCheckedChange={(v) => settings.setEnterToSend(v)}
      />
    </div>
  </SettingsCard>

  <!-- כרטיס שרת — beUrl. נשמר על blur/Enter; ריק = same-origin / פרוקסי Vite -->
  <SettingsCard title={t("settings.beUrl.label")}>
    <label class="flex flex-col gap-1.5">
      <input
        dir="ltr"
        bind:value={beUrlInput}
        placeholder="https://be.example.com"
        class="rounded-xl px-3 py-3 text-sm font-mono outline-none border"
        style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
        oninput={() => (beUrlStatus = { kind: "idle" })}
        onblur={commitBeUrl}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commitBeUrl()
          }
        }}
      />
      {#if beUrlStatus.kind === "error"}
        <span class="text-[12px]" style="color:var(--recording)">{t("settings.beUrl.invalid")}</span>
      {:else if beUrlStatus.kind === "saved"}
        <span class="text-[12px]" style="color:var(--accent)">{t("settings.beUrl.saved")}</span>
      {:else}
        <span class="text-[12px]" style="color:var(--fg-muted)">{t("settings.beUrl.help")}</span>
      {/if}
    </label>
  </SettingsCard>

  <!-- גרסה — (cache-version slice) -->
  <p class="text-center text-[11px] mt-4" style="color:var(--fg-muted)" dir="ltr">
    {t("settings.version")} {version}
  </p>

  <!-- כפתורי איפוס + שמור -->
  <div class="flex gap-3 mt-2">
    <button
      class="flex-1 py-3 rounded-xl text-sm font-medium border"
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg-dim)"
      onclick={() => {
        settings.setSpeakThoughts(true)
        settings.setNarrateTools(true)
        settings.setTranslateThoughts(true)
        settings.setCarMode(false)
        settings.setShowThoughts(true)
        settings.setShowTools(false)
        settings.setEnterToSend(true)
      }}
    >
      {t("settings.reset")}
    </button>
    <button
      class="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
      style="background:var(--accent)"
      onclick={() => goto("/chat")}
    >
      {t("settings.saveOpen")}
    </button>
  </div>
</section>
