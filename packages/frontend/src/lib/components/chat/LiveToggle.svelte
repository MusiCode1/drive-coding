<script lang="ts">
/**
 * LiveToggle — open/close Gemini Live secretary session.
 *
 * Slice: live-ears, Commit 7.
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
</script>

<button
  class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all"
  style={live.isOpen
    ? "background:var(--recording); color:#fff"
    : "background:var(--bg-card); color:var(--fg)"}
  class:disabled={!live.canOpen && !live.isOpen}
  disabled={!live.canOpen && !live.isOpen}
  onclick={() => void live.toggle()}
  aria-pressed={live.isOpen}
  aria-label={t(labelKey)}
>
  <RadioIcon size={16} strokeWidth={2} />
  {t(labelKey)}
</button>

{#if live.error}
  <p class="text-xs text-center mt-1" style="color:var(--recording)" role="alert">
    {t(live.error)}
  </p>
{/if}

<style>
  .disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
