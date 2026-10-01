<script lang="ts">
import type { CliUsageRow } from "$lib/adapters/cli-usage"
import { getI18n } from "$lib/context"
import { cliDisplayName } from "$lib/util/cli-display"
import { formatContextUsageCost } from "$lib/util/context-usage-cost"

const { rows, locale = "he" }: { rows: CliUsageRow[]; locale?: string } = $props()

const t = getI18n().t

function fmtCompact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(n)
}

function fmtTs(ms: number): string {
  if (ms <= 0) return "—"
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(ms)
}

function fmtCost(row: CliUsageRow): string {
  if (row.costMixedCurrency) return t("usage.clis.costMixed")
  if (row.costAmount === undefined) return "—"
  return formatContextUsageCost({ amount: row.costAmount, currency: row.costCurrency }, locale)
}
</script>

<div class="overflow-x-auto rounded-xl border" style="border-color:var(--border)">
  <table class="w-full text-sm" style="color:var(--fg)">
    <thead>
      <tr class="text-[12px] text-start" style="color:var(--fg-dim); background:var(--bg-card)">
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.cli")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.projects")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.sessions")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.turns")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.peakHeld")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.sumHeld")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.compactions")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.cost")}</th>
        <th class="px-3 py-2 font-medium">{t("usage.clis.col.activity")}</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.cliKind)}
        <tr class="border-t" style="border-color:var(--border)">
          <td class="px-3 py-2 font-medium">{cliDisplayName(row.cliKind)}</td>
          <td class="px-3 py-2">
            {#if row.lastSeenProjects > 0}
              {t("usage.clis.lastSeenPrefix")}<span dir="ltr">{row.lastSeenProjects}</span>{t(
                "usage.clis.lastSeenSuffix",
              )}
            {:else}
              —
            {/if}
          </td>
          <td class="px-3 py-2">
            {#if row.reportsUsage}
              {row.sessions}
            {:else}
              <span class="text-[12px]" style="color:var(--fg-muted)">{t("usage.clis.noUsageReport")}</span>
            {/if}
          </td>
          <td class="px-3 py-2" dir="ltr">
            {#if row.reportsUsage}
              {row.turns}
            {:else}
              —
            {/if}
          </td>
          <td class="px-3 py-2" dir="ltr">
            {#if row.reportsUsage}
              {fmtCompact(row.peakUsed)}
            {:else}
              —
            {/if}
          </td>
          <td class="px-3 py-2" dir="ltr">
            {#if row.reportsUsage}
              {fmtCompact(row.sumHeld)}
            {:else}
              —
            {/if}
          </td>
          <td class="px-3 py-2" dir="ltr">
            {#if row.reportsUsage}
              {row.compactions}
            {:else}
              —
            {/if}
          </td>
          <td class="px-3 py-2" dir="ltr">{row.reportsUsage ? fmtCost(row) : "—"}</td>
          <td class="px-3 py-2 text-[12px]" style="color:var(--fg-dim)" dir="ltr">
            {#if row.reportsUsage}
              {fmtTs(row.firstSeenAt)} – {fmtTs(row.lastSeenAt)}
            {:else if row.lastSeenAtRegistry}
              {row.lastSeenAtRegistry}
            {:else}
              —
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
