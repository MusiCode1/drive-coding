<script lang="ts">
/**
 * AgentVoicePicker — voice of the agent's built-in Live (slice codex-voice-poc).
 * Same <Select> as GeminiVoicePicker; the list and per-voice details (accent, description, sample)
 * come from the provider (`_drive/voice/listVoices`). The button plays the chosen voice's sample.
 */
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getAgentVoice, getI18n } from "$lib/context"

const agentVoice = getAgentVoice()
const t = getI18n().t

const options: SelectOption[] = $derived(
  agentVoice.voices.map((id) => {
    const d = agentVoice.voiceDetails[id]
    const parts = [
      d?.accent,
      d?.description,
      id === agentVoice.defaultVoice ? t("agentVoice.defaultVoice") : undefined,
    ]
    const description = parts.filter(Boolean).join(" · ")
    return { value: id, label: id, description: description || null }
  }),
)
const current = $derived(agentVoice.effectiveVoice)
const hasSample = $derived(!!current && !!agentVoice.voiceDetails[current]?.previewUrl)
const playing = $derived(!!current && agentVoice.previewing === current)
</script>

<div class="flex items-start gap-2">
  <div class="min-w-0 flex-1">
    <Select
      value={current ?? ""}
      {options}
      title={t("settings.liveVoice.label")}
      ariaLabel={t("settings.liveVoice.label")}
      disabled={options.length === 0}
      onchange={(v) => agentVoice.setVoice(v)}
    />
  </div>
  <button
    type="button"
    class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
    style="border-color:var(--border); color:var(--fg-dim)"
    disabled={!hasSample}
    onclick={() => agentVoice.togglePreview()}
    aria-pressed={playing}
    aria-label={t(playing ? "agentVoice.stopPreview" : "agentVoice.preview")}
    title={t(playing ? "agentVoice.stopPreview" : "agentVoice.preview")}
  >
    {#if playing}<SquareIcon size={14} />{:else}<PlayIcon size={14} />{/if}
  </button>
</div>
