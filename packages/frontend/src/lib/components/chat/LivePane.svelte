<script lang="ts">
/**
 * LivePane — the Live input pane: transcript, then a centred row of [settings · toggle] (extracted from
 * RecordFooter).
 *
 * Settings sit beside the big toggle, not stacked above it, so a small screen keeps its height:
 * the built-in Live switch (when the session's agent has its own voice) and the voice picker of
 * the engine Live will open — the agent's voices, or Gemini's (slice codex-voice-poc).
 */

import AudioLinesIcon from "@lucide/svelte/icons/audio-lines"
import { getAgentVoice, getI18n, getLive } from "$lib/context"
import AgentVoicePicker from "./AgentVoicePicker.svelte"
import GeminiVoiceChip from "./GeminiVoiceChip.svelte"
import LiveToggle from "./LiveToggle.svelte"
import LiveTranscript from "./LiveTranscript.svelte"

const t = getI18n().t
const live = getLive()
const agentVoice = getAgentVoice()
const idle = $derived(!live.isOpen && !agentVoice.active)
</script>

<LiveTranscript />
<div class="live-pane-row w-full">
  <div class="live-pane-side flex min-w-0 flex-col items-end gap-2">
    {#if idle}
      {#if agentVoice.supported}
        <button
          type="button"
          class="codex-chip inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold"
          class:codex-chip--on={agentVoice.preferNative}
          onclick={() => agentVoice.setPreferNative(!agentVoice.preferNative)}
          aria-pressed={agentVoice.preferNative}
          aria-label={t("agentVoice.useNative")}
          title={t("agentVoice.useNative")}
        >
          <AudioLinesIcon size={13} strokeWidth={2} />
          {t("agentVoice.useNativeShort")}
        </button>
      {/if}
      {#if agentVoice.selected}
        <AgentVoicePicker />
      {:else}
        <GeminiVoiceChip />
      {/if}
    {/if}
  </div>
  <div class="flex flex-col items-center">
    <LiveToggle />
  </div>
</div>

<style>
  /* settings beside the toggle, as one centred group. (A symmetric spacer column kept the
     toggle exactly centred but left the settings ~110px on a phone — measured.) */
  .live-pane-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
  }

  .live-pane-side {
    min-width: 0;
    max-width: 11rem;
  }

  .live-pane-side:empty {
    display: none;
  }

  .codex-chip {
    background: transparent;
    border-color: var(--border);
    color: var(--fg-dim);
  }

  .codex-chip--on {
    background: color-mix(in srgb, var(--recording) 16%, transparent);
    border-color: color-mix(in srgb, var(--recording) 45%, transparent);
    color: var(--recording);
  }
</style>
