<script lang="ts">
import PermissionCountdown from "$lib/components/chat/PermissionCountdown.svelte"
import type { ScopeDetailRow } from "$lib/types/scope-prompt-view"

let { rows }: { rows: ScopeDetailRow[] } = $props()
</script>

<div class="detail-rows">
  {#each rows as row (row.label)}
    <div class="detail-row">
      <span class="detail-label">{row.label}</span>
      {#if row.kind === "countdown"}
        <PermissionCountdown expiresAtMs={row.expiresAtMs} />
      {:else}
        <span class="detail-value" dir="auto">{row.value}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .detail-rows {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .detail-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.5rem;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .detail-label {
    color: var(--fg-dim);
    min-width: 4.5rem;
    flex-shrink: 0;
  }

  .detail-value {
    color: var(--fg);
    word-break: break-word;
    flex: 1;
    min-width: 0;
  }
</style>
