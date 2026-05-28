<script lang="ts">
/**
 * VoicePicker — <select> wired to Settings.voiceId.
 *
 * On mount, triggers `settings.loadVoices()` (idempotent — won't refetch
 * if already loaded). Failure shows an aria-label; the select itself still
 * contains the current voiceId as the single fallback option so the
 * pipeline doesn't break.
 *
 * Per parallel-safe-code.md, the VM holds the data; this component is a
 * thin leaf that reads it and writes back on change.
 */
import { getI18n, getSettings } from "$lib/context"

const settings = getSettings()
const t = getI18n().t

$effect(() => {
  // Idempotent — Settings.loadVoices guards against duplicate / repeat calls.
  void settings.loadVoices()
})

function onChange(e: Event) {
  const target = e.currentTarget as HTMLSelectElement
  settings.setVoiceId(target.value)
}

// Show the currently-selected voiceId as a placeholder option when the
// catalog is empty (initial load, or after a failure). Otherwise the
// select would show nothing and the bind would be broken visually.
const hasVoices = $derived(settings.availableVoices.length > 0)
</script>

<label class="voice-picker" title={t("chat.voicePicker.label")}>
  <span class="picker-label">{t("chat.voicePicker.label")}</span>
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
</label>

<style>
  .voice-picker {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-inline-end: 0.75rem;
    color: var(--fg-dim);
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .picker-label {
    user-select: none;
  }

  select {
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 0.8rem;
    max-width: 12rem;
    cursor: pointer;
  }

  select:focus {
    outline: none;
    border-color: var(--accent);
  }

  select:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
