/** Default when ACP omits currency (numeric-only cost from reduce normalization). */
const DEFAULT_CONTEXT_USAGE_CURRENCY = "USD"

/**
 * Formats session context `usage_update` cost (SessionBudgetPopover).
 * slice token-usage-persistence · C1 — must not throw when `currency` is absent.
 */
export function formatContextUsageCost(
  cost: { amount: number; currency?: string },
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cost.currency ?? DEFAULT_CONTEXT_USAGE_CURRENCY,
  }).format(cost.amount)
}
