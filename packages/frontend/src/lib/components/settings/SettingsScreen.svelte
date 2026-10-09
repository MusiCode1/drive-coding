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
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getI18n, getNotify, getSettings } from "$lib/context"
import { resolveSessionTransport, type SessionTransport } from "$lib/session/session-transport"
import { ttsStatus } from "$lib/view-models/tts-status.svelte"
import LanguageSelect from "./LanguageSelect.svelte"
import PalettePicker from "./PalettePicker.svelte"
import SettingsCard from "./SettingsCard.svelte"
import SettingToggle from "./SettingToggle.svelte"
import TokenContextUsageCard from "./TokenContextUsageCard.svelte"
import TtsStatusCard from "./TtsStatusCard.svelte"
import VoiceSpeechSettingsCard from "./VoiceSpeechSettingsCard.svelte"

const settings = getSettings()
const notify = getNotify()
const t = getI18n().t
const translateDisabled = $derived(!settings.speakThoughts)

onMount(() => {
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

  <VoiceSpeechSettingsCard
    {translateDisabled}
    onSpeakThoughtsChange={onSpeakThoughtsChange}
  />

  <!-- כרטיס מצב TTS — tts-status-ui -->
  <SettingsCard title={t("settings.ttsStatus.title")}>
    <TtsStatusCard />
  </SettingsCard>

  <SettingsCard title={t("settings.tokenUsage.title")}>
    <a
      href="/usage"
      class="text-[13px] font-medium mb-2 inline-block"
      style="color:var(--accent)"
    >
      {t("usage.page.link")}
    </a>
    <TokenContextUsageCard />
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
        label={t("settings.toggle.sessionMemo")}
        checked={settings.showSessionMemo}
        onCheckedChange={(v) => settings.setShowSessionMemo(v)}
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
