<script lang="ts">
/**
 * VoiceChip — a compact voice picker for the Live pane's side column (slice codex-voice-poc).
 * A pill with the current voice; tapping opens a popup listing every voice with its details.
 * Tapping a row picks it and closes the popup. When the engine has sample clips (`onPreview` +
 * `option.sample`), each row also carries ▶/■ to hear that voice without picking it; closing
 * the popup stops the sample.
 */
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down"
import { Dialog } from "bits-ui"
import { getI18n } from "$lib/context"
import VoiceChipRow from "./VoiceChipRow.svelte"

export type VoiceChipOption = { value: string; label: string; detail?: string; sample?: boolean }

let {
  value,
  options,
  ariaLabel,
  disabled = false,
  previewing = null,
  previewError = null,
  onchange,
  onPreview,
  onPreviewStop,
}: {
  value: string
  options: VoiceChipOption[]
  ariaLabel: string
  disabled?: boolean
  previewing?: string | null
  /** Why the last sample could not play — shown in the popup. */
  previewError?: string | null
  onchange: (value: string) => void
  onPreview?: (value: string) => void
  onPreviewStop?: () => void
} = $props()

const t = getI18n().t
let open = $state(false)
const current = $derived(options.find((o) => o.value === value))

function setOpen(next: boolean) {
  open = next
  if (!next) onPreviewStop?.()
}
</script>

<button
  type="button"
  class="voice-chip inline-flex h-9 min-w-0 max-w-full shrink items-center gap-1 rounded-full border px-3 text-sm"
  class:opacity-50={disabled}
  {disabled}
  aria-label={ariaLabel}
  aria-haspopup="dialog"
  aria-expanded={open}
  title={current?.detail ?? ariaLabel}
  onclick={() => setOpen(true)}
>
  <span class="truncate" dir="auto">{current?.label ?? value}</span>
  <ChevronDownIcon class="shrink-0 opacity-70" size={14} />
</button>

<Dialog.Root {open} onOpenChange={setOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60" />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-sm max-h-[70dvh] flex flex-col rounded-2xl border shadow-xl"
      style="background:var(--bg-elev); border-color:var(--border)"
    >
      <Dialog.Title class="px-4 pt-4 pb-2 text-sm font-semibold shrink-0" style="color:var(--fg-dim)">
        {ariaLabel}
      </Dialog.Title>
      {#if previewError}
        <p class="px-4 pb-2 text-xs" style="color:var(--recording)" role="alert" dir="auto">
          {t("agentVoice.previewFailed")} <span dir="ltr">{previewError}</span>
        </p>
      {/if}
      <div class="flex min-h-0 flex-col overflow-y-auto px-2 pb-3">
        {#each options as o (o.value)}
          <VoiceChipRow
            option={o}
            selected={o.value === value}
            playing={previewing === o.value}
            onpick={() => {
              onchange(o.value)
              setOpen(false)
            }}
            onpreview={onPreview && o.sample ? () => onPreview(o.value) : undefined}
          />
        {/each}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .voice-chip {
    background: var(--bg-card);
    border-color: var(--border);
    color: var(--fg);
  }
</style>
