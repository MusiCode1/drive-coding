<script lang="ts">
/**
 * LiveTranscript — streaming Live secretary transcript (not bubbles).
 *
 * Slice: live-ears, Commit 7.
 */

import { getI18n, getLive } from "$lib/context"

const live = getLive()
const t = getI18n().t
</script>

{#if live.transcript.length > 0}
  <div
    class="w-full max-w-lg flex flex-col gap-2 text-sm rounded-xl p-3"
    style="background:var(--bg-card); border:1px solid var(--border)"
    aria-live="polite"
  >
    {#each live.transcript as entry (entry.role + entry.text)}
      <div class="flex flex-col gap-0.5">
        <span class="text-xs font-semibold" style="color:var(--fg-dim)">
          {t(entry.role === "user" ? "live.transcript.user" : "live.transcript.assistant")}
        </span>
        <span style="color:var(--fg)" class:opacity-70={!entry.final}>{entry.text}</span>
      </div>
    {/each}
  </div>
{/if}
