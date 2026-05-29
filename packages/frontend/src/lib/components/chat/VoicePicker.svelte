<script lang="ts">
/**
 * VoicePicker — רכיב <select> חשוף שמחובר ל-Settings.voiceId.
 *
 * אגנוסטי לפריסה (Layout-agnostic): אב הרכיב עוטף אותו באיזו תווית / מיכל
 * שמתאימים לטופס שמסביב. בשימוש על ידי:
 *   - routes/+page.svelte (טופס התחברות, עם תווית בסגנון טופס)
 *
 * בעת טעינה (mount), מפעיל את `settings.loadVoices()` (אידמפוטנטי). כשלון משאיר
 * את ה-voiceId הנוכחי כאפשרות חלופית (fallback) כדי שתהליך ה-TTS לא יישבר.
 *
 * לפי parallel-safe-code.md, ה-VM (View Model) מחזיק את הנתונים; הרכיב הזה
 * הוא קצה (leaf) דק שקורא + כותב שדה אחד בלבד.
 */
import { getI18n, getSettings } from "$lib/context"

const settings = getSettings()
const t = getI18n().t

$effect(() => {
  // אידמפוטנטי — מוגן בתוך Settings.loadVoices.
  void settings.loadVoices()
})

function onChange(e: Event) {
  const target = e.currentTarget as HTMLSelectElement
  settings.setVoiceId(target.value)
}

// הצג את ה-voiceId שנבחר כרגע כאפשרות חלופית (placeholder) כאשר
// הקטלוג ריק כדי של-<select> עדיין יהיה ערך.
const hasVoices = $derived(settings.availableVoices.length > 0)
</script>

<select
  value={settings.voiceId}
  onchange={onChange}
  disabled={settings.voicesLoading && !hasVoices}
  aria-label={t("chat.voicePicker.label")}
>
  {#if hasVoices}
    {#each settings.availableVoices as voice (voice.voice_id)}
      <option value={voice.voice_id}>{voice.name}</option>
    {/each}
  {:else if settings.voicesLoading}
    <option value={settings.voiceId}>{t("chat.voicePicker.loading")}</option>
  {:else if settings.voicesError !== null}
    <option value={settings.voiceId}>{t("chat.voicePicker.error")}</option>
  {:else}
    <option value={settings.voiceId}>{settings.voiceId}</option>
  {/if}
</select>

<style>
  /* יורש עיצוב מהטופס האב. הוסף דריסות במידת הצורך. */
  select:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
