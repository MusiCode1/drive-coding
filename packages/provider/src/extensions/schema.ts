/**
 * schema.ts — Unified extension methods registry (ArkType).
 *
 * Single source of truth for ext method contracts.
 * Adding a new ext method = one line here.
 *
 * n: number | null — null = no-limit (SDK setMaxThinkingTokens(null) is valid).
 */

import { type } from "arktype"

// ─── quota (session-budget-meter) ─────────────────────────────────────────
// Provider-agnostic quota contract. No provider names, window names, or
// SDK-specific fields belong here — see brief §2 "כלל בידוד ספק".

/** Rolling window (e.g. 5h/7d) measured from a fixed duration, not a provider ID. */
const QuotaPeriodRolling = type({
  kind: "'rolling'",
  durationSeconds: "number > 0",
})
/** Calendar-aligned window (day/week/month) — generic, no provider-specific reset policy. */
const QuotaPeriodCalendar = type({
  kind: "'calendar'",
  unit: "'day' | 'week' | 'month'",
})
export const QuotaPeriod = QuotaPeriodRolling.or(QuotaPeriodCalendar)

/** Simple percentage-only consumption (0..100). */
const QuotaConsumptionPercentage = type({
  kind: "'percentage'",
  usedPct: "0 <= number <= 100",
})
/** Absolute used/limit consumption with a unit — UI computes percentage safely. */
const QuotaConsumptionAbsolute = type({
  kind: "'absolute'",
  used: "number >= 0",
  limit: "number > 0",
  unit: "'requests' | 'tokens' | 'credits'",
})
export const QuotaConsumption = QuotaConsumptionPercentage.or(QuotaConsumptionAbsolute)

export const QuotaWindow = type({
  id: "string",
  period: QuotaPeriod,
  consumption: QuotaConsumption,
  resetsAtMs: "number | null",
})

export const QuotaSnapshot = type({
  provider: "string",
  "plan?": "string",
  windows: QuotaWindow.array(),
})

/** Unified registry of ext methods. Each entry: { params, result } ArkType schemas. */
export const extMethods = {
  "_drive/setThinkingTokens": {
    // n: number | null — null = cancel-limit (no-limit). SDK setMaxThinkingTokens accepts null.
    params: type({ sessionId: "string", n: "number | null" }),
    result: type({ ok: "true" }),
  },
  "_drive/getQuota": {
    params: type({ sessionId: "string" }),
    // top-level result is always an object — never a bare `null` (brief §2, §6 risk table).
    result: type({ snapshot: QuotaSnapshot.or("null") }),
  },
  // Future: compact / setMcpServers / commands — add here
} as const

export type ExtMethodName = keyof typeof extMethods
