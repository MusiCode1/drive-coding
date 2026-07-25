<script lang="ts">
/**
 * SessionBudgetPopover — תוכן ה-popover read-only "תקציב סשן".
 *
 * slice session-budget-meter, Commit 5.
 *
 * שתי sections:
 *   1. context — ACP `usage_update` תקני (percent, compact tokens, cost).
 *   2. quota — windows רב-ספקי מ-`_drive/getQuota` (generic, `supports.usage` gated).
 *
 * גנרי לחלוטין: אין כאן `if (cliKind === "claude")`, אין הנחה על מספר windows, אין
 * שימוש ב-window.id לקביעת label — רק period/consumption (brief §2 + Anti-patterns).
 */
import type { QuotaWindow } from "@drive-coding/provider/extensions"
import { getI18n, getSession } from "$lib/context"
import { formatQuotaPeriod, formatTimeUntil } from "$lib/util/formatting"

const session = getSession()
const i18n = getI18n()
const t = i18n.t

/**
 * Intl (he locale) embeds bidi control chars (RLM U+200F etc.) in numeric/currency
 * output. Harmless in normal RTL flow, but breaks visual order when the string is
 * placed inside an explicit `dir="ltr"` container (as required here — brief §4
 * Commit 5 "path/numbers מקבלים dir=ltr"). We control directionality via `dir`
 * ourselves, so strip the embedded marks to avoid double-direction conflicts.
 */
function stripBidiMarks(s: string): string {
  return s.replace(/[‎‏⁦-⁩]/g, "")
}

// ─── context section ─────────────────────────────────────────────────────

const contextPercent = $derived.by(() => {
  const usage = session.contextUsage
  if (usage === null || usage.size <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((usage.used / usage.size) * 100)))
})

const compactTokens = $derived.by(() => {
  const usage = session.contextUsage
  if (usage === null) return ""
  const fmt = new Intl.NumberFormat(i18n.locale, { notation: "compact" })
  return `${stripBidiMarks(fmt.format(usage.used))} / ${stripBidiMarks(fmt.format(usage.size))}`
})

const costLabel = $derived.by(() => {
  const cost = session.contextUsage?.cost
  if (cost == null) return null
  const formatted = new Intl.NumberFormat(i18n.locale, {
    style: "currency",
    currency: cost.currency,
  }).format(cost.amount)
  return stripBidiMarks(formatted)
})

// ─── quota section ────────────────────────────────────────────────────────

/** progress% מחושב בבטחה — absolute: used/limit (limit>0 מובטח ע"י הסכמה); percentage: usedPct. */
function progressPercent(window: QuotaWindow): number {
  if (window.consumption.kind === "percentage") {
    return Math.min(100, Math.max(0, window.consumption.usedPct))
  }
  const { used, limit } = window.consumption
  if (limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
}
</script>

<div class="flex flex-col gap-3 text-sm">
  <div class="text-[13px] font-semibold" style="color:var(--fg)">
    {t("sessionBudget.title")}
  </div>

  <!-- ─── context section ─── -->
  <div class="flex flex-col gap-1.5">
    <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
      {t("sessionBudget.context.heading")}
    </span>
    {#if session.contextUsage !== null}
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
    {/if}
  </div>

  <!-- ─── quota section — supports.usage gated (brief §4 Commit 5) ─── -->
  {#if session.supports.usage}
    <div class="flex flex-col gap-1.5">
      <span class="text-[11px] font-semibold uppercase tracking-wide" style="color:var(--fg-muted)">
        {t("sessionBudget.quota.heading")}
      </span>
      {#if session.quotaLoading}
        <span class="text-[12px]" style="color:var(--fg-muted)">
          {t("sessionBudget.quota.loading")}
        </span>
      {:else if session.quota === null}
        <span class="text-[12px]" style="color:var(--fg-muted)">
          {t("sessionBudget.quota.unavailable")}
        </span>
      {:else}
        {#each session.quota.windows as window (window.id)}
          {@const pct = progressPercent(window)}
          <div class="flex flex-col gap-1 rounded-xl p-2" style="background:var(--bg-card)">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="text-[12px] font-semibold" style="color:var(--fg)">
                {formatQuotaPeriod(window.period, i18n.locale)}
              </span>
              {#if window.consumption.kind === "percentage"}
                <span class="text-[12px] font-mono" style="color:var(--fg-dim)" dir="ltr">{pct}%</span>
              {:else}
                <!-- label+numbers מעורבים — dir="ltr" על כל השורה (מראה TtsStatusCard.svelte:112,
                     brief reading-list reference), לא רק על המספרים — נמנע מהיפוך bidi. -->
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
  {/if}
</div>
