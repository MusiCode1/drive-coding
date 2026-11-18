<script lang="ts">
/**
 * VoiceChipRow — one voice in VoiceChip's popup (slice codex-voice-poc): the row picks the voice;
 * the ▶/■ beside it (only when the voice has a sample) plays it without picking.
 */
import CheckIcon from "@lucide/svelte/icons/check"
import PlayIcon from "@lucide/svelte/icons/play"
import SquareIcon from "@lucide/svelte/icons/square"
import { getI18n } from "$lib/context"
import type { VoiceChipOption } from "./VoiceChip.svelte"

let {
  option,
  selected,
  playing,
  onpick,
  onpreview,
}: {
  option: VoiceChipOption
  selected: boolean
  playing: boolean
  onpick: () => void
  onpreview?: (() => void) | undefined
} = $props()

const t = getI18n().t
const previewLabel = $derived(t(playing ? "agentVoice.stopPreview" : "agentVoice.preview"))
</script>

<div class="flex items-center gap-1" dir="auto">
  <button
    type="button"
    class="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-lg px-3 py-3 text-start text-sm hover:bg-white/5"
    style="color:var(--fg)"
    aria-current={selected}
    onclick={onpick}
  >
    <span class="flex min-w-0 flex-col gap-0.5">
      <span dir="auto">{option.label}</span>
      {#if option.detail}
        <span class="text-[11px] leading-snug" style="color:var(--fg-dim)" dir="auto">{option.detail}</span>
      {/if}
    </span>
    {#if selected}
      <CheckIcon size={18} style="color:var(--accent)" class="mt-0.5 shrink-0" />
    {/if}
  </button>
  {#if onpreview}
    <button
      type="button"
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
      style="border-color:var(--border); color:{playing ? 'var(--accent)' : 'var(--fg-dim)'}"
      onclick={onpreview}
      aria-pressed={playing}
      aria-label={`${previewLabel} — ${option.label}`}
      title={previewLabel}
    >
      {#if playing}<SquareIcon size={13} />{:else}<PlayIcon size={13} />{/if}
    </button>
  {/if}
</div>
