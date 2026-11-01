<script lang="ts">
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import { getI18n } from "$lib/context"
import { formatQuotaPeriod, formatTimeUntil } from "$lib/util/formatting"
import { quotaWindowProgressPercent } from "$lib/util/session-budget-display"

let {
  quotaLoading,
  quota,
}: {
  quotaLoading: boolean
  quota: QuotaSnapshot | null
} = $props()

const i18n = getI18n()
const t = i18n.t
</script>

<div class="flex flex-col gap-1.5">
  <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
    {t("sessionBudget.quota.heading")}
  </span>
  {#if quotaLoading}
    <span class="text-[12px]" style="color:var(--fg-muted)">
      {t("sessionBudget.quota.loading")}
    </span>
  {:else if quota === null}
    <span class="text-[12px]" style="color:var(--fg-muted)">
      {t("sessionBudget.quota.unavailable")}
    </span>
  {:else}
    {#each quota.windows as window (window.id)}
      {@const pct = quotaWindowProgressPercent(window)}
      <div class="flex flex-col gap-1 rounded-xl p-2" style="background:var(--bg-card)">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-[12px] font-semibold" style="color:var(--fg)">
            {formatQuotaPeriod(window.period, i18n.locale)}
          </span>
          {#if window.consumption.kind === "percentage"}
            <span class="text-[12px] font-mono" style="color:var(--fg-dim)" dir="ltr">{pct}%</span>
          {:else}
            <span class="text-[12px] font-mono" style="color:var(--fg-dim)" dir="ltr">
              {t("sessionBudget.quota.used")}: {window.consumption.used}
              {t("sessionBudget.quota.of")} {window.consumption.limit}
            </span>
          {/if}
        </div>
        <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--border)">
          <div
            class="h-full rounded-full transition-all"
            style="width:{pct}%; background:var(--accent)"
          ></div>
        </div>
        {#if window.resetsAtMs !== null}
          <span class="text-[11px]" style="color:var(--fg-muted)">
            {t("sessionBudget.quota.resetsIn")} {formatTimeUntil(window.resetsAtMs, i18n.locale)}
          </span>
        {/if}
      </div>
    {/each}
  {/if}
</div>
