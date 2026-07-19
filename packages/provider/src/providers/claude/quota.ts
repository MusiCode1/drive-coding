/**
 * quota.ts — Claude quota normalizer: SDKControlGetUsageResponse → generic QuotaSnapshot.
 *
 * Provider isolation (brief §2): the ONLY place in the codebase that knows about
 * `five_hour`, `seven_day`, `rate_limits_available`, `subscription_type`, or that
 * parses `resets_at` (ISO 8601) via Date.parse. Everything else (UI, ext transport,
 * generic contract) only ever sees QuotaSnapshot / QuotaWindow.
 */

import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk"
import type { QuotaSnapshot, QuotaWindow } from "../../extensions/index.js"

const FIVE_HOUR_SECONDS = 5 * 60 * 60
const SEVEN_DAY_SECONDS = 7 * 24 * 60 * 60

type RawRateLimitWindow = { utilization: number | null; resets_at: string | null } | null | undefined

/** ISO 8601 → epoch-ms, or null if missing/invalid. Parsed ONLY here (Claude-specific). */
function parseResetsAt(iso: string | null | undefined): number | null {
  if (iso == null) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** utilization null/undefined/NaN/non-finite → window is omitted entirely (brief §4 Commit 3). */
function isUsableUtilization(u: number | null | undefined): u is number {
  return typeof u === "number" && Number.isFinite(u)
}

/** Clamp to the 0..100 range the generic schema requires — defensive, upstream should already be. */
function clampPct(u: number): number {
  return Math.min(100, Math.max(0, u))
}

/** Builds one rolling-percentage window, or null if the window is absent/unusable. */
function buildRollingWindow(
  id: string,
  durationSeconds: number,
  raw: RawRateLimitWindow,
): QuotaWindow | null {
  if (raw == null || !isUsableUtilization(raw.utilization)) return null
  return {
    id,
    period: { kind: "rolling", durationSeconds },
    consumption: { kind: "percentage", usedPct: clampPct(raw.utilization) },
    resetsAtMs: parseResetsAt(raw.resets_at),
  }
}

/**
 * Normalizes claude's experimental usage/rate-limit response into the generic
 * QuotaSnapshot contract.
 *
 * null = no limits available for this account/session type (API key, Bedrock, Vertex,
 * or missing profile scope) — a valid, successful response, not an error.
 *
 * Only `five_hour` and `seven_day` are mapped (brief §4 Commit 3 mapping rules).
 * `seven_day_oauth_apps` / `seven_day_opus` / `seven_day_sonnet` are model/app-scoped
 * limits — out of scope (brief §2 "model-scoped limits → future"). `session` totals,
 * `extra_usage`, `spend`, `behaviors`, and any other/unknown field are ignored — this
 * function only ever reads the fields it explicitly destructures.
 */
export function normalizeClaudeQuota(raw: SDKControlGetUsageResponse): QuotaSnapshot | null {
  if (!raw.rate_limits_available || raw.rate_limits == null) return null

  const windows: QuotaWindow[] = []
  const fiveHour = buildRollingWindow("five_hour", FIVE_HOUR_SECONDS, raw.rate_limits.five_hour)
  if (fiveHour) windows.push(fiveHour)
  const sevenDay = buildRollingWindow("seven_day", SEVEN_DAY_SECONDS, raw.rate_limits.seven_day)
  if (sevenDay) windows.push(sevenDay)

  return {
    provider: "claude",
    ...(raw.subscription_type != null ? { plan: raw.subscription_type } : {}),
    windows,
  }
}
