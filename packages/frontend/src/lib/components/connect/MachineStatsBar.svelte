<script lang="ts">
/**
 * MachineStatsBar — מחוון RAM/CPU קומפקטי בראש "תהליכים פעילים".
 *
 * רכיב מצגת טהור (props בלבד, אין fetch/state כאן — ה-fetch ב-ActiveProcessesPanel
 * דרך getMachineStats() על אותו poll קיים, 12s). null → לא מציג כלום (לא "0%").
 *
 * ─── system ─── (slice-be-machine-stats Commit 3)
 */
import type { MachineStats } from "@drive-coding/core"
import { getI18n } from "$lib/context"

interface Props {
  stats: MachineStats | null
}

const { stats }: Props = $props()

const t = getI18n().t

function pctColor(pct: number): string {
  if (pct >= 90) return "var(--recording)"
  if (pct >= 75) return "var(--accent)"
  return "var(--muted)"
}

const memGb = $derived(stats ? (stats.totalMemMB / 1024).toFixed(1) : "")
const usedGb = $derived(stats ? (stats.usedMemMB / 1024).toFixed(1) : "")
</script>

{#if stats}
  <div class="machine-bar" role="status" aria-label={t("connect.machine.label")}>
    <span class="machine-item" style="color:{pctColor(stats.memPct)}">
      {t("connect.machine.memory")}: {usedGb}/{memGb} GB ({stats.memPct}%)
    </span>
    <span class="machine-sep">·</span>
    <span class="machine-item" style="color:{pctColor(stats.loadPct)}">
      {t("connect.machine.cpu")}: {stats.loadPct}%
    </span>
  </div>
{/if}

<style>
  .machine-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.45rem 0.9rem;
    font-size: 0.72rem;
    border-bottom: 1px solid var(--border);
    direction: ltr;
  }

  .machine-item {
    white-space: nowrap;
  }

  .machine-sep {
    color: var(--fg-dim);
    opacity: 0.5;
  }
</style>
