<script lang="ts">
/**
 * LivePane — the Live input pane: transcript, then a row of [settings | toggle] (extracted from
 * RecordFooter).
 *
 * Settings sit beside the big toggle, not stacked above it, so a small screen keeps its height:
 * the built-in Live switch (when the session's agent has its own voice) and the voice picker of
 * the engine Live will open — the agent's voices, or Gemini's (slice codex-voice-poc).
 */

import { getAgentVoice, getI18n, getLive, getSettings } from "$lib/context"
import AgentVoicePicker from "./AgentVoicePicker.svelte"
import GeminiVoicePicker from "./GeminiVoicePicker.svelte"
import LiveToggle from "./LiveToggle.svelte"
import LiveTranscript from "./LiveTranscript.svelte"

const t = getI18n().t
const live = getLive()
const agentVoice = getAgentVoice()
const settings = getSettings()
const idle = $derived(!live.isOpen && !agentVoice.active)
</script>

<LiveTranscript />
<div class="live-pane-row w-full">
  <div class="live-pane-side flex min-w-0 flex-col gap-2">
    {#if idle}
      {#if agentVoice.supported}
        <label class="flex items-center gap-1.5 text-xs leading-tight" style="color:var(--fg-dim)">
          <input
            type="checkbox"
            checked={agentVoice.preferNative}
            onchange={(e) => agentVoice.setPreferNative(e.currentTarget.checked)}
          />
          {t("agentVoice.useNative")}
        </label>
      {/if}
      {#if agentVoice.selected}
        <AgentVoicePicker />
      {:else}
        <GeminiVoicePicker
          value={settings.liveVoice}
          labelKey="settings.liveVoice.label"
          onchange={(v) => settings.setLiveVoice(v)}
        />
      {/if}
    {/if}
  </div>
  <div class="flex flex-col items-center">
    <LiveToggle />
  </div>
  <div aria-hidden="true"></div>
</div>

<style>
  /* settings | toggle | spacer — the toggle stays centred; the settings column takes the side. */
  .live-pane-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
  }

  .live-pane-side {
    justify-self: end;
    width: 100%;
    max-width: 11rem;
  }
</style>
