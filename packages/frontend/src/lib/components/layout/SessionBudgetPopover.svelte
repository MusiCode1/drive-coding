<script lang="ts">
/**
 * SessionBudgetPopover — תוכן ה-popover read-only "תקציב סשן".
 *
 * slice session-budget-meter, Commit 5.
 */
import {
  compactionsFromCycles,
  fetchTokenUsage,
  sumOfCyclePeaks,
  type TokenUsageRecord,
} from "$lib/adapters/token-usage"
import SessionBudgetQuotaPanel from "$lib/components/layout/SessionBudgetQuotaPanel.svelte"
import { getI18n, getSession } from "$lib/context"
import { formatContextUsageCost } from "$lib/util/context-usage-cost"
import { stripBidiMarks } from "$lib/util/session-budget-display"

const session = getSession()
const budget = session.budget
const i18n = getI18n()
const t = i18n.t

const contextPercent = $derived.by(() => {
  const usage = budget.contextUsage
  if (usage === null || usage.size <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((usage.used / usage.size) * 100)))
})

const compactTokens = $derived.by(() => {
  const usage = budget.contextUsage
  if (usage === null) return ""
  const fmt = new Intl.NumberFormat(i18n.locale, { notation: "compact" })
  return `${stripBidiMarks(fmt.format(usage.used))} / ${stripBidiMarks(fmt.format(usage.size))}`
})

const costLabel = $derived.by(() => {
  const cost = budget.contextUsage?.cost
  if (cost == null) return null
  return stripBidiMarks(formatContextUsageCost(cost, i18n.locale))
})

let persistedUsage = $state<TokenUsageRecord | null>(null)

$effect(() => {
  const sid = session.sessionId
  if (sid === null) {
    persistedUsage = null
    return
  }
  void fetchTokenUsage({ limit: 50 })
    .then((list) => {
      persistedUsage = list.find((r) => r.acpSessionId === sid) ?? null
    })
    .catch(() => {
      persistedUsage = null
    })
})

const compactFmt = $derived(new Intl.NumberFormat(i18n.locale, { notation: "compact" }))
</script>

<div class="flex flex-col gap-3 text-sm">
  <div class="text-[13px] font-semibold" style="color:var(--fg)">
    {t("sessionBudget.title")}
  </div>

  <div class="flex flex-col gap-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
      {t("sessionBudget.context.heading")}
    </span>
    {#if budget.contextUsage !== null}
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[13px] font-mono" style="color:var(--fg)" dir="ltr">{contextPercent}%</span>
        <span class="text-[12px] font-mono" style="color:var(--fg-dim)" dir="ltr">{compactTokens}</span>
      </div>
      <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--border)">
        <div
          class="h-full rounded-full transition-all"
          style="width:{contextPercent}%; background:var(--accent)"
        ></div>
      </div>
      {#if costLabel !== null}
        <span class="text-[12px]" style="color:var(--fg-dim)">
          {t("sessionBudget.context.cost")}: <span dir="ltr">{costLabel}</span>
        </span>
      {/if}
      {#if persistedUsage !== null}
        <span class="text-[12px]" style="color:var(--fg-dim)">
          {t("sessionBudget.context.compactions")}: {compactionsFromCycles(persistedUsage.cycles)}
        </span>
        <span class="text-[12px]" style="color:var(--fg-dim)">
          {t("sessionBudget.context.sumHeld")}:
          <span dir="ltr">{stripBidiMarks(compactFmt.format(sumOfCyclePeaks(persistedUsage.cycles)))}</span>
        </span>
      {/if}
    {/if}
  </div>

  {#if session.supports.usage}
    <SessionBudgetQuotaPanel quotaLoading={budget.quotaLoading} quota={budget.quota} />
  {/if}
</div>
