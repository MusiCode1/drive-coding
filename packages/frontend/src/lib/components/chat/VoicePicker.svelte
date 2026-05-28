<script lang="ts">
/**
 * VoicePicker — bare <select> wired to Settings.voiceId.
 *
 * Layout-agnostic: the parent wraps it in whatever label / container
 * matches the surrounding form. Used by:
 *   - routes/+page.svelte (connect form, with form-style label)
 *
 * On mount, triggers `settings.loadVoices()` (idempotent). Failure leaves
 * the current voiceId as a fallback option so the TTS pipeline doesn't break.
 *
 * Per parallel-safe-code.md, the VM holds the data; this component is a
 * thin leaf that reads + writes one field.
 */
import { getI18n, getSettings } from "$lib/context"

const settings = getSettings()
const t = getI18n().t

$effect(() => {
  // Idempotent — guarded inside Settings.loadVoices.
  void settings.loadVoices()
})

function onChange(e: Event) {
  const target = e.currentTarget as HTMLSelectElement
  settings.setVoiceId(target.value)
}

// Show the currently-selected voiceId as a placeholder option when the
// catalog is empty so the select still has a value.
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
  /* Inherits styles from parent form. Add overrides if needed. */
  select:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
