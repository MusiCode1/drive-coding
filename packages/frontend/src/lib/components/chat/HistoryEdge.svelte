<script lang="ts">
import { getI18n } from "$lib/context"
import type { HistoryState } from "$lib/view-models/history-state.svelte"
import { HISTORY_EDGE_HEIGHT, observeHistoryEdge } from "./history-edge"

let { history, hasBubbles }: { history: HistoryState; hasBubbles: boolean } = $props()
const t = getI18n().t
const disabled = $derived(history.reloading || history.loadingOlder)

function loadVisible(): void {
  if (hasBubbles && history.window.hasMore && !disabled && !history.error && !history.olderError) {
    void history.loadOlder()
  }
}
</script>

{#if hasBubbles || history.error}
  <div
    class="flex shrink-0 items-center justify-center gap-3 border-b border-border px-3 text-sm"
    style:height={`${HISTORY_EDGE_HEIGHT}px`}
    role="region"
    aria-label={t("chat.history.edge.label")}
    use:observeHistoryEdge={loadVisible}
  >
    {#if history.error}
      <span class="text-destructive">{t("chat.history.error")}</span>
      <button type="button" class="underline" disabled={disabled} onclick={() => void history.retry()}>
        {t("chat.history.retry")}
      </button>
    {:else if history.olderError}
      <span class="text-destructive">{t("chat.history.error")}</span>
      <button type="button" class="underline" disabled={disabled} onclick={() => void history.loadOlder()}>
        {t("chat.history.retry")}
      </button>
    {:else if history.loadingOlder}
      <span role="status">{t("chat.history.loadingOlder")}</span>
    {:else if history.window.hasMore}
      <button type="button" class="underline" disabled={disabled} onclick={() => void history.loadOlder()}>
        {t("chat.history.loadOlder")}
      </button>
    {:else}
      <span>{t("chat.history.start")}</span>
    {/if}
  </div>
{/if}
