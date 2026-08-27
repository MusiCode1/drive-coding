<script lang="ts">
/**
 * LiveToggle — open/close Gemini Live secretary session.
 *
 * Primary CTA in the live pane: large circular button (same footprint as MicLarge).
 * Label sits under the circle — text does not fit inside a round control.
 *
 * Slice: live-ears, Commit 7 · enlarged circle (live-input-mode follow-up).
 */

import RadioIcon from "@lucide/svelte/icons/radio"
import { getI18n, getLive } from "$lib/context"

const live = getLive()
const t = getI18n().t

const labelKey = $derived(
  live.isOpen
    ? "live.toggle.close"
    : live.state === "connecting"
      ? "live.status.connecting"
      : "live.toggle.open",
)

const isDisabled = $derived(!live.canOpen && !live.isOpen)
</script>

<div class="live-toggle flex flex-col items-center gap-2">
  <button
    type="button"
    class="live-toggle-btn rounded-full border-none cursor-pointer flex items-center justify-center transition-all"
    class:disabled={isDisabled}
    style={live.isOpen
      ? "background:var(--recording); color:#fff"
      : "background:var(--accent); color:#fff"}
    disabled={isDisabled}
    onclick={() => void live.toggle()}
    aria-pressed={live.isOpen}
    aria-label={t(labelKey)}
  >
    <RadioIcon size={40} strokeWidth={1.5} />
  </button>
  <span class="text-sm font-semibold" style="color:var(--fg-dim)" aria-hidden="true">
    {t(labelKey)}
  </span>
</div>

{#if live.error}
  <p class="text-xs text-center mt-1" style="color:var(--recording)" role="alert">
    {t(live.error)}
  </p>
{/if}

<style>
  .live-toggle-btn {
    width: 110px;
    height: 110px;
  }

  .live-toggle-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
