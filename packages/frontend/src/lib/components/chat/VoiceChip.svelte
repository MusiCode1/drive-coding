<script lang="ts">
/**
 * VoiceChip — a compact voice picker for the Live pane's side column (slice codex-voice-poc).
 * A pill with the current voice; tapping opens the platform's own picker (a transparent native
 * <select> over the pill), which on a phone is the OS list — no room-hungry trigger + description.
 */
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down"

export type VoiceChipOption = { value: string; label: string; detail?: string }

let {
  value,
  options,
  ariaLabel,
  disabled = false,
  onchange,
}: {
  value: string
  options: VoiceChipOption[]
  ariaLabel: string
  disabled?: boolean
  onchange: (value: string) => void
} = $props()

const current = $derived(options.find((o) => o.value === value))
</script>

<label
  class="voice-chip relative inline-flex h-9 min-w-0 max-w-full shrink items-center gap-1 rounded-full border px-3 text-sm"
  class:opacity-50={disabled}
  title={current?.detail ?? ariaLabel}
>
  <span class="truncate" dir="auto">{current?.label ?? value}</span>
  <ChevronDownIcon class="shrink-0 opacity-70" size={14} />
  <select
    class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
    aria-label={ariaLabel}
    {disabled}
    {value}
    onchange={(e) => onchange(e.currentTarget.value)}
  >
    {#each options as o (o.value)}
      <option value={o.value}>{o.detail ? `${o.label} — ${o.detail}` : o.label}</option>
    {/each}
  </select>
</label>

<style>
  .voice-chip {
    background: var(--bg-card);
    border-color: var(--border);
    color: var(--fg);
  }
</style>
