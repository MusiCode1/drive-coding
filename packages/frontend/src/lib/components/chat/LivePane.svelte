<script lang="ts">
/**
 * LivePane — the Live input pane: transcript, voice picker, toggle (extracted from RecordFooter).
 *
 * The picker follows the engine Live will open: the agent's own voices when its built-in Live is
 * selected (slice codex-voice-poc), Gemini's otherwise.
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
</script>

<LiveTranscript />
{#if !live.isOpen && !agentVoice.active}
  <label class="flex w-full max-w-xs flex-col gap-1.5">
    <span class="text-[13px] text-center" style="color:var(--fg-dim)"
      >{t("settings.liveVoice.label")}</span
    >
    {#if agentVoice.selected}
      <AgentVoicePicker />
    {:else}
      <GeminiVoicePicker
        value={settings.liveVoice}
        labelKey="settings.liveVoice.label"
        onchange={(v) => settings.setLiveVoice(v)}
      />
    {/if}
  </label>
{/if}
<LiveToggle />
