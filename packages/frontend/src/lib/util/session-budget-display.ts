import type { QuotaWindow } from "@drive-coding/provider/extensions"

/** Strip bidi marks so `dir="ltr"` containers render numeric order correctly. */
export function stripBidiMarks(s: string): string {
  return s.replace(/[‎‏⁦-⁩]/g, "")
}

/** progress% — absolute: used/limit; percentage: usedPct (schema guarantees limit>0 when absolute). */
export function quotaWindowProgressPercent(window: QuotaWindow): number {
  if (window.consumption.kind === "percentage") {
    return Math.min(100, Math.max(0, window.consumption.usedPct))
  }
  const { used, limit } = window.consumption
  if (limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
}
