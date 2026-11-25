<script lang="ts">
import { getI18n } from "$lib/context"
import type { HistoryState } from "$lib/view-models/history-state.svelte"

let { history }: { history: HistoryState } = $props()
const t = getI18n().t
const showBar = $derived(history.window.hasMore || history.error !== null)
const disabled = $derived(history.reloading)
</script>

{#if showBar}
  <div
    class="flex min-h-10 shrink-0 items-center justify-center gap-3 border-b border-border px-3 py-2 text-sm"
    role="region"
    aria-label={t("chat.history.edge.label")}
  >
    {#if history.error}
      <span class="text-destructive">{t("chat.history.error")}</span>
      <button type="button" class="underline" disabled={disabled} onclick={() => void history.retry()}>
        {t("chat.history.retry")}
      </button>
    {:else if history.window.hasMore}
      <span class="text-muted-foreground">{t("chat.history.hasOlder")}</span>
      <button
        type="button"
        class="underline"
        disabled={disabled}
        onclick={() => void history.loadFull()}
      >
        {t("chat.history.loadAll")}
      </button>
    {/if}
  </div>
{/if}