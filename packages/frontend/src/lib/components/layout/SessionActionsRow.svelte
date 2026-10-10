<script lang="ts">
/**
 * SessionActionsRow — שורת הפעולות העליונה: כיבוי · השאר-רץ · השתקה · ⚙.
 *
 * 🛑 הסימן הוא `status !== "idle"` ולא `inSession` של `+layout.svelte:305-311`,
 * שהוא `connected || disconnected` ומוציא `error` במפורש — פרדיקט לעניין אחר.
 * דווקא ב-`error` וב-`disconnected` כפתור הכיבוי הוא הכי נחוץ.
 */
import PowerIcon from "@lucide/svelte/icons/power"
import SettingsIcon from "@lucide/svelte/icons/settings"
import Volume2Icon from "@lucide/svelte/icons/volume-2"
import VolumeXIcon from "@lucide/svelte/icons/volume-x"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { getI18n, getSession, getSpeaker, getUiShell } from "$lib/context"
import LeaveRunningButton from "./LeaveRunningButton.svelte"

const t = getI18n().t
const session = getSession()
const speaker = getSpeaker()
const uiShell = getUiShell()
const onSettings = $derived(page.url.pathname === "/settings")
/** "idle" = טרם נוצר סוכן ⇒ פקדים שפועלים על סשן מוסתרים. */
const hasSession = $derived(session.status !== "idle")

function onDisconnect() {
  session.detach()
  goto("/")
}

function toggleSettings() {
  if (onSettings) {
    goto("/chat")
  } else {
    uiShell.closeSheet()
    goto("/settings")
  }
}
</script>

<!-- סדר DOM ב-RTL: disconnect=ימני-קיצוני, leave-running משמאלו, audio, settings -->
<div class="flex items-center gap-2 shrink-0">
  {#if hasSession}
    <button
      class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border"
      style="border-color:var(--border); color:var(--recording)"
      onclick={onDisconnect}
      aria-label={t("session.closeSession")}
      title={t("session.closeSession")}
    >
      <PowerIcon size={16} strokeWidth={1.75} />
    </button>
    <LeaveRunningButton />
  {/if}

  <!-- audio master toggle — גלובלי, לא תלוי-סשן -->
  <button
    class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border"
    style="border-color:var(--border); color:var(--fg-dim)"
    onclick={() => speaker.toggle()}
    aria-label={speaker.enabled ? t("header.audioOn") : t("header.audioOff")}
    title={speaker.enabled ? t("header.audioOn") : t("header.audioOff")}
  >
    {#if speaker.enabled}
      <Volume2Icon size={16} strokeWidth={1.75} />
    {:else}
      <VolumeXIcon size={16} strokeWidth={1.75} />
    {/if}
  </button>

  <!-- ⚙ — ניווט, לא תלוי-סשן -->
  <button
    class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border"
    style="border-color:var(--border); color:{onSettings ? 'var(--accent)' : 'var(--fg-dim)'}"
    onclick={toggleSettings}
    aria-label={t("header.settings")}
    aria-pressed={onSettings}
    title={t("header.settings")}
  >
    <SettingsIcon size={16} strokeWidth={1.75} />
  </button>
</div>
