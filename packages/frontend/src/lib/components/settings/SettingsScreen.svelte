<script lang="ts">
/**
 * SettingsScreen — מסך הגדרות מחדש לפי מוקאפ redesign-vnext (שורות 584-650).
 *
 * כרטיסים:
 *  1. "חיבור" — תיקייה (placeholder), מודל (placeholder), session (placeholder)
 *  2. "קול ודיבור" — VoicePicker + 4 toggles (speakThoughts/narrateTools/translateThoughts/carMode)
 *
 * כפתורי איפוס ושמור.
 *
 * ─── settings-redesign (redesign-3) ───
 */
import { getI18n, getSettings } from "$lib/context"
import SettingsCard from "./SettingsCard.svelte"
import SettingToggle from "./SettingToggle.svelte"
import VoicePicker from "$lib/components/chat/VoicePicker.svelte"

const settings = getSettings()
const t = getI18n().t

// translateThoughts disabled כש-speakThoughts כבוי
const translateDisabled = $derived(!settings.speakThoughts)
</script>

<section
  class="flex flex-col flex-1 min-h-0 overflow-y-auto chat-scroll px-4 pt-20 pb-8 w-full max-w-2xl mx-auto"
>
  <h1 class="text-xl font-semibold mb-1">{t("settings.title")}</h1>

  <!-- כרטיס חיבור -->
  <SettingsCard title={t("settings.connection")}>
    <!-- תיקיית עבודה — placeholder ל-redesign-6 -->
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.folder.label")}</span>
      <div class="flex gap-2">
        <input
          dir="ltr"
          disabled
          placeholder="/home/user"
          class="flex-1 rounded-xl px-3 py-3 text-sm font-mono outline-none border opacity-50"
          style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
        />
        <button
          disabled
          class="px-4 rounded-xl text-sm font-medium border opacity-50"
          style="background:var(--bg-card); border-color:var(--border); color:var(--fg-dim)"
        >
          {t("settings.folder.pick")}
        </button>
      </div>
    </label>

    <!-- מודל — placeholder ל-redesign-3 C5 / SessionOptionsPanel -->
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.model.label")}</span>
      <select
        disabled
        class="rounded-xl px-3 py-3 text-sm outline-none border opacity-50 appearance-none"
        style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
      >
        <option>—</option>
      </select>
    </label>

    <!-- Session — placeholder ל-redesign-6 -->
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.session.label")}</span>
      <select
        disabled
        class="rounded-xl px-3 py-3 text-sm outline-none border opacity-50 appearance-none"
        style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
      >
        <option>—</option>
      </select>
    </label>
  </SettingsCard>

  <!-- כרטיס קול ודיבור -->
  <SettingsCard title={t("settings.voiceSpeech")}>
    <!-- Voice picker -->
    <label class="flex flex-col gap-1.5">
      <span class="text-[13px]" style="color:var(--fg-dim)">{t("settings.voice.label")}</span>
      <VoicePicker />
    </label>

    <!-- 4 toggles — מוקאפ שורות 626-643 -->
    <div class="flex flex-col divide-y" style="border-color:var(--border)">
      <SettingToggle
        label={t("settings.toggle.speakThoughts")}
        checked={settings.speakThoughts}
        onCheckedChange={(v) => settings.setSpeakThoughts(v)}
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
      <SettingToggle
        label={t("settings.toggle.carMode")}
        checked={settings.carMode}
        onCheckedChange={(v) => settings.setCarMode(v)}
      />
    </div>
  </SettingsCard>

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
      }}
    >
      {t("settings.reset")}
    </button>
    <button
      class="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
      style="background:var(--accent)"
      onclick={() => history.back()}
    >
      {t("settings.saveOpen")}
    </button>
  </div>
</section>
