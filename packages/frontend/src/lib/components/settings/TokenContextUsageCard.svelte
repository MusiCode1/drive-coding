<script lang="ts">
/**
 * TokenContextUsageCard — persisted context usage summaries (slice token-usage-persistence C4).
 */
import { getI18n, getSettings } from "$lib/context"
import {
  compactionsFromCycles,
  fetchTokenUsage,
  sumOfCyclePeaks,
  type TokenUsageRecord,
} from "$lib/adapters/token-usage"

const t = getI18n().t
const settings = getSettings()

let loading = $state(false)
let records = $state<TokenUsageRecord[]>([])
let error = $state(false)

async function refresh() {
  loading = true
  error = false
  try {
    records = await fetchTokenUsage({ cwd: settings.lastCwd || undefined, limit: 20 })
  } catch {
    records = []
    error = true
  } finally {
    loading = false
  }
}

$effect(() => {
  void settings.lastCwd
  void refresh()
})

function fmtCompact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(n)
}
</script>

<div class="flex flex-col gap-2 rounded-xl p-3 text-sm" style="background:var(--bg-card)">
  <div class="flex items-center justify-end gap-2">
    <button
      type="button"
      class="text-[12px] px-2 py-1 rounded-lg border"
      style="color:var(--fg-dim); border-color:var(--border)"
      onclick={() => refresh()}
      disabled={loading}
    >
      {loading ? t("settings.tokenUsage.loading") : t("settings.tokenUsage.refresh")}
    </button>
  </div>
  {#if error}
    <span class="text-[12px]" style="color:var(--fg-muted)">{t("settings.tokenUsage.error")}</span>
  {:else if records.length === 0}
    <span class="text-[12px]" style="color:var(--fg-muted)">{t("settings.tokenUsage.empty")}</span>
  {:else}
    {#each records as rec (rec.acpSessionId)}
      <div class="flex flex-col gap-0.5 border-t pt-2" style="border-color:var(--border)">
        <span class="text-[11px] font-mono truncate" style="color:var(--fg-dim)" dir="ltr">
          {rec.acpSessionId.slice(0, 8)}…
        </span>
        <span class="text-[12px]" style="color:var(--fg)">
          {t("settings.tokenUsage.compactions")}: {compactionsFromCycles(rec.cycles)}
          · {t("settings.tokenUsage.sumHeld")}: <span dir="ltr">{fmtCompact(sumOfCyclePeaks(rec.cycles))}</span>
        </span>
      </div>
    {/each}
  {/if}
</div>
