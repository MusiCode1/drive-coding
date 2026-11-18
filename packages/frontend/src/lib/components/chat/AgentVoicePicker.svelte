<script lang="ts">
/**
 * AgentVoicePicker — voice of the agent's built-in Live, as a compact chip + sample button
 * (slice codex-voice-poc). The list and per-voice details (accent, description, sample) come from
 * the provider (`_drive/voice/listVoices`).
 */
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import { getAgentVoice, getI18n } from "$lib/context"
import VoiceChip from "./VoiceChip.svelte"

const agentVoice = getAgentVoice()
const t = getI18n().t

const options = $derived(
  agentVoice.voices.map((id) => {
    const d = agentVoice.voiceDetails[id]
    const isDefault = id === agentVoice.defaultVoice ? t("agentVoice.defaultVoice") : undefined
    const detail = [d?.accent, d?.description, isDefault].filter(Boolean).join(" · ")
    return { value: id, label: id, ...(detail ? { detail } : {}) }
  }),
)
const current = $derived(agentVoice.effectiveVoice)
const hasSample = $derived(!!current && !!agentVoice.voiceDetails[current]?.previewUrl)
const playing = $derived(!!current && agentVoice.previewing === current)
</script>

<div class="flex min-w-0 max-w-full items-center gap-1.5">
  <VoiceChip
    value={current ?? ""}
    {options}
    ariaLabel={t("settings.liveVoice.label")}
    disabled={options.length === 0}
    onchange={(v) => agentVoice.setVoice(v)}
  />
  <button
    type="button"
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
    class:opacity-40={!hasSample}
    style="border-color:var(--border); color:var(--fg-dim)"
    disabled={!hasSample}
    onclick={() => agentVoice.togglePreview()}
    aria-pressed={playing}
    aria-label={t(playing ? "agentVoice.stopPreview" : "agentVoice.preview")}
    title={t(playing ? "agentVoice.stopPreview" : "agentVoice.preview")}
  >
    {#if playing}<SquareIcon size={13} />{:else}<PlayIcon size={13} />{/if}
  </button>
</div>
