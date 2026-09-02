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
 * ─── settings-redesign (redesign-3) · redesign-fix · V4a (TTS provider) · tts-provider-availability ───
 */

import { onMount } from "svelte"
import { version } from "$app/environment"
import { goto } from "$app/navigation"
import { env } from "$env/dynamic/public"
import GeminiVoicePicker from "$lib/components/chat/GeminiVoicePicker.svelte"
import VoicePicker from "$lib/components/chat/VoicePicker.svelte"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getI18n, getNotify, getSettings } from "$lib/context"
import { resolveSessionTransport, type SessionTransport } from "$lib/session/session-transport"
import { ttsReasonMessage } from "$lib/util/tts-reason"
import { ttsCapabilities } from "$lib/view-models/capabilities.svelte"
import { ttsStatus } from "$lib/view-models/tts-status.svelte"
import GeminiDirectingControls from "./GeminiDirectingControls.svelte"
import LanguageSelect from "./LanguageSelect.svelte"
import PalettePicker from "./PalettePicker.svelte"
import SettingsCard from "./SettingsCard.svelte"
import SettingToggle from "./SettingToggle.svelte"
import TtsStatusCard from "./TtsStatusCard.svelte"

const settings = getSettings()
const notify = getNotify()
const t = getI18n().t
const translateDisabled = $derived(!settings.speakThoughts)

// ─── TTS provider + availability ─── (V4a + tts-provider-availability)
const caps = $derived(ttsCapabilities.caps)

// per-provider disabled: available===false → disabled. undefined (loading) → enabled (optimistic).
// description on disabled options → reason message shown below the label in Select.
const ttsProviderOptions = $derived<SelectOption[]>([
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
])

// Fallback: if the currently selected provider became unavailable, switch to the other
$effect(() => {
  if (!caps) return
  const current = settings.ttsProvider
  const currentCap = caps[current]
  if (currentCap?.available === false) {
    // Find an available provider
    const fallback = (Object.keys(caps) as Array<"elevenlabs" | "google">).find(
      (p) => caps[p]?.available !== false,
    )
    if (fallback) {
      settings.setTtsProvider(fallback)
    }
    // If both unavailable: don't switch, show allUnavailable warning instead
  }
})

// Derived for UI messages
const currentUnavailable = $derived(
  caps !== undefined && caps[settings.ttsProvider]?.available === false,
)
const allUnavailable = $derived(
  caps !== undefined &&
    caps["elevenlabs"]?.available === false &&
    caps["google"]?.available === false,
)

// Refresh capabilities + tts-status on mount (non-blocking)
onMount(() => {
  void ttsCapabilities.refresh()
  void ttsStatus.refresh()
})

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

// ─── session transport ─── (slice transport-polish C4)
// העדפה קבועה (localStorage). null = לא נבחרה → env נבחר. בחירה ידנית גוברת על env.
// ה-Select מציג את האפקטיבי לסשן הבי (resolveSessionTransport({ stored: null, env }))
// כשההעדפה null — לא את העקיפה (sessionStorage), שגוברת רק בטאב הזה.
const sessionTransportOptions = $derived<SelectOption[]>([
  { value: "ws", label: t("settings.sessionTransport.ws") },
  { value: "http", label: t("settings.sessionTransport.http") },
])

const sessionTransportDisplay = $derived(
  settings.sessionTransport ??
    resolveSessionTransport({ stored: null, env: env.PUBLIC_SESSION_TRANSPORT }),
)

// ─── notifications quiet-block ─── (slice notify-quiet-prompt)
let quietHint = $state(false)
let pendingEnable = $state(false)

function clearQuietHint() {
  quietHint = false
  pendingEnable = false
}

async function onNotificationsChange(v: boolean) {
  if (v) {
    if (notify.permission === "default") {
      // Quiet UI (Edge/Chrome): requestPermission() often does not resolve until
      // the user clicks the address-bar bell — show the hint *before* awaiting.
      settings.setNotifications(false)
      quietHint = true
      pendingEnable = true
      const result = await notify.requestPermission()
      if (result === "granted") {
        settings.setNotifications(true)
        clearQuietHint()
      } else if (result === "denied") {
        settings.setNotifications(false)
        clearQuietHint()
      }
      // else still default — keep quietHint + pendingEnable
    } else if (notify.permission === "granted") {
      settings.setNotifications(true)
    }
  } else {
    settings.setNotifications(false)
    clearQuietHint()
  }
}

async function retryNotifications() {
  settings.setNotifications(false)
  quietHint = true
  pendingEnable = true
  const result = await notify.requestPermission()
  if (result === "granted") {
    settings.setNotifications(true)
    clearQuietHint()
  } else if (result === "denied") {
    settings.setNotifications(false)
    clearQuietHint()
  }
}

$effect(() => {
  if (notify.permission === "granted" && pendingEnable) {
    settings.setNotifications(true)
    clearQuietHint()
  }
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
    <!-- TTS provider selector — (V4a + tts-provider-availability) -->
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.ttsProvider.label")}</span>
      <Select
        options={ttsProviderOptions}
        value={settings.ttsProvider}
        title={t("settings.ttsProvider.label")}
        onchange={(v) => settings.setTtsProvider(v as "elevenlabs" | "google")}
      />
      {#if allUnavailable}
        <span class="text-[12px]" style="color:var(--recording)">{t("settings.ttsProvider.allUnavailable")}</span>
      {:else if currentUnavailable}
        <span class="text-[12px]" style="color:var(--accent)">{t("settings.ttsProvider.fallbackNotice")}</span>
      {/if}
    </label>

    <!-- בורר קול — conditional לפי הספק הפעיל (V4b) -->
    {#if settings.ttsProvider === "elevenlabs"}
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.voice.label")}</span>
        <VoicePicker />
      </label>
    {:else if settings.ttsProvider === "google"}
      <label class="flex flex-col gap-1.5">
        <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.geminiVoice.label")}</span>
        <GeminiVoicePicker />
      </label>
      <GeminiDirectingControls />
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

  <!-- כרטיס מצב TTS — tts-status-ui -->
  <SettingsCard title={t("settings.ttsStatus.title")}>
    <TtsStatusCard />
  </SettingsCard>

  <!-- כרטיס מסך — wake-lock (slice-wake-lock) -->
  <SettingsCard title={t("settings.screen.label")}>
    <SettingToggle
      label={t("settings.toggle.keepScreenOn")}
      checked={settings.screenWakeLock}
      onCheckedChange={(v) => settings.setScreenWakeLock(v)}
    />
  </SettingsCard>

  <!-- כרטיס התראות — notify-local · notify-quiet-prompt -->
  <SettingsCard title={t("settings.notifications.title")}>
    <SettingToggle
      label={t("settings.toggle.notifications")}
      checked={settings.notifications}
      disabled={notify.permission === "unsupported" || notify.permission === "denied"}
      onCheckedChange={onNotificationsChange}
    />
    {#if notify.permission === "denied"}
      <p class="text-sm" style="color:var(--fg-dim)">{t("settings.notifications.blocked")}</p>
    {:else if quietHint}
      <p class="text-sm mt-2" role="status" style="color:var(--fg)">
        {t("settings.notifications.quietHint")}
      </p>
      <button
        type="button"
        class="text-sm font-medium mt-1"
        style="color:var(--accent)"
        onclick={() => void retryNotifications()}
      >
        {t("settings.notifications.retry")}
      </button>
    {/if}
  </SettingsCard>

  <!-- כרטיס תצוגת צ'אט — display-toggle-consistency · compact-activity -->
  <SettingsCard title={t("settings.chatDisplay")}>
    <div class="flex flex-col">
      <SettingToggle
        label={t("settings.toggle.showThoughts")}
        checked={settings.showThoughts}
        disabled={settings.compactActivity}
        onCheckedChange={(v) => settings.setShowThoughts(v)}
      />
      <SettingToggle
        label={t("settings.toggle.showTools")}
        checked={settings.showTools}
        disabled={settings.compactActivity}
        onCheckedChange={(v) => settings.setShowTools(v)}
      />
      <SettingToggle
        label={t("settings.toggle.compactActivity")}
        checked={settings.compactActivity}
        onCheckedChange={(v) => settings.setCompactActivity(v)}
      />
      <SettingToggle
        label={t("settings.toggle.autoLoadRemoteImages")}
        checked={settings.autoLoadRemoteImages}
        onCheckedChange={(v) => settings.setAutoLoadRemoteImages(v)}
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

  <!-- כרטיס מתקדם — טרנספורט סשן (slice transport-polish C4) -->
  <SettingsCard title={t("settings.sessionTransport.label")}>
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.sessionTransport.label")}</span>
      <Select
        options={sessionTransportOptions}
        value={sessionTransportDisplay}
        title={t("settings.sessionTransport.label")}
        onchange={(v) => settings.setSessionTransport(v as SessionTransport)}
      />
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
        settings.setCompactActivity(false)
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
