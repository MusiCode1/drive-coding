/**
 * quota.test.ts — TDD (Red → Green) for normalizeClaudeQuota.
 *
 * Covers (brief §4 Commit 3 Tests): two windows, one missing, unavailable, null,
 * 0%, 100%, bad utilization, unknown future fields. Provider isolation: this is
 * the ONLY test file that references five_hour/seven_day/rate_limits_available.
 */

import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import { normalizeClaudeQuota } from "./quota.js"

/** Minimal valid `session` block — content irrelevant to the quota normalizer. */
const SESSION_STUB: SDKControlGetUsageResponse["session"] = {
  total_cost_usd: 0,
  total_api_duration_ms: 0,
  total_duration_ms: 0,
  total_lines_added: 0,
  total_lines_removed: 0,
  model_usage: {},
}

function makeRaw(
  overrides: Partial<SDKControlGetUsageResponse>,
): SDKControlGetUsageResponse {
  return {
    session: SESSION_STUB,
    subscription_type: null,
    rate_limits_available: true,
    rate_limits: null,
    ...overrides,
  } as SDKControlGetUsageResponse
}

describe("normalizeClaudeQuota", () => {
  it("returns null when rate_limits_available is false", () => {
    const raw = makeRaw({ rate_limits_available: false, rate_limits: null })
    expect(normalizeClaudeQuota(raw)).toBeNull()
  })

  it("returns null when rate_limits is null even if rate_limits_available is true", () => {
    const raw = makeRaw({ rate_limits_available: true, rate_limits: null })
    expect(normalizeClaudeQuota(raw)).toBeNull()
  })

  it("maps both five_hour and seven_day into two rolling-percentage windows", () => {
    const raw = makeRaw({
      subscription_type: "max",
      rate_limits: {
        five_hour: { utilization: 42, resets_at: "2026-07-19T20:00:00.000Z" },
        seven_day: { utilization: 88, resets_at: "2026-07-25T00:00:00.000Z" },
      },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot).toEqual({
      provider: "claude",
      plan: "max",
      windows: [
        {
          id: "five_hour",
          period: { kind: "rolling", durationSeconds: 5 * 60 * 60 },
          consumption: { kind: "percentage", usedPct: 42 },
          resetsAtMs: new Date("2026-07-19T20:00:00.000Z").getTime(),
        },
        {
          id: "seven_day",
          period: { kind: "rolling", durationSeconds: 7 * 24 * 60 * 60 },
          consumption: { kind: "percentage", usedPct: 88 },
          resetsAtMs: new Date("2026-07-25T00:00:00.000Z").getTime(),
        },
      ],
    })
  })

  it("omits plan when subscription_type is null", () => {
    const raw = makeRaw({
      subscription_type: null,
      rate_limits: { five_hour: { utilization: 10, resets_at: null } },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot?.plan).toBeUndefined()
    expect("plan" in (snapshot ?? {})).toBe(false)
  })

  it("one window missing — only the present window is included", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: { utilization: 50, resets_at: null } },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot?.windows).toHaveLength(1)
    expect(snapshot?.windows[0]?.id).toBe("five_hour")
  })

  it("window present but utilization is null — window is omitted (not a 0% window)", () => {
    const raw = makeRaw({
      rate_limits: {
        five_hour: { utilization: null, resets_at: "2026-07-19T20:00:00.000Z" },
        seven_day: { utilization: 30, resets_at: null },
      },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot?.windows).toHaveLength(1)
    expect(snapshot?.windows[0]?.id).toBe("seven_day")
  })

  it("window is null (not just missing key) — omitted", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: null, seven_day: { utilization: 20, resets_at: null } },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot?.windows).toHaveLength(1)
    expect(snapshot?.windows[0]?.id).toBe("seven_day")
  })

  it("0% utilization is a valid window (not treated as missing)", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: { utilization: 0, resets_at: null } },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot?.windows).toHaveLength(1)
    expect(snapshot?.windows[0]?.consumption).toEqual({ kind: "percentage", usedPct: 0 })
  })

  it("100% utilization is a valid window", () => {
    const raw = makeRaw({
      rate_limits: { seven_day: { utilization: 100, resets_at: null } },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot?.windows[0]?.consumption).toEqual({ kind: "percentage", usedPct: 100 })
  })

  it("bad utilization (NaN) — window omitted, no crash", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: { utilization: Number.NaN, resets_at: null } },
    })
    expect(() => normalizeClaudeQuota(raw)).not.toThrow()
    expect(normalizeClaudeQuota(raw)?.windows).toHaveLength(0)
  })

  it("bad utilization (Infinity) — window omitted, no crash", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: { utilization: Number.POSITIVE_INFINITY, resets_at: null } },
    })
    expect(normalizeClaudeQuota(raw)?.windows).toHaveLength(0)
  })

  it("utilization outside 0..100 is clamped, not thrown from the normalizer", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: { utilization: 142, resets_at: null } },
    })
    expect(normalizeClaudeQuota(raw)?.windows[0]?.consumption).toEqual({
      kind: "percentage",
      usedPct: 100,
    })
  })

  it("invalid resets_at (unparsable ISO) → resetsAtMs:null, no NaN, no crash", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: { utilization: 10, resets_at: "not-a-date" } },
    })
    const win = normalizeClaudeQuota(raw)?.windows[0]
    expect(win?.resetsAtMs).toBeNull()
    expect(Number.isNaN(win?.resetsAtMs)).toBe(false)
  })

  it("missing resets_at (null) → resetsAtMs:null", () => {
    const raw = makeRaw({
      rate_limits: { five_hour: { utilization: 10, resets_at: null } },
    })
    expect(normalizeClaudeQuota(raw)?.windows[0]?.resetsAtMs).toBeNull()
  })

  it("empty rate_limits object (no windows declared) → empty windows array, not null", () => {
    const raw = makeRaw({ rate_limits: {} })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.windows).toEqual([])
  })

  it("ignores seven_day_oauth_apps / seven_day_opus / seven_day_sonnet / model_scoped / extra_usage (out of scope)", () => {
    const raw = makeRaw({
      rate_limits: {
        five_hour: { utilization: 5, resets_at: null },
        seven_day_oauth_apps: { utilization: 99, resets_at: null },
        seven_day_opus: { utilization: 99, resets_at: null },
        seven_day_sonnet: { utilization: 99, resets_at: null },
        model_scoped: [{ display_name: "Fable", utilization: 99, resets_at: null }],
        extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 5, utilization: 5 },
      },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot?.windows).toHaveLength(1)
    expect(snapshot?.windows[0]?.id).toBe("five_hour")
  })

  it("ignores unknown future fields on the raw response without crashing", () => {
    const raw = {
      ...makeRaw({ rate_limits: { five_hour: { utilization: 5, resets_at: null } } }),
      some_future_field: { anything: true },
      behaviors: { some: "new-shape" },
    } as unknown as SDKControlGetUsageResponse
    expect(() => normalizeClaudeQuota(raw)).not.toThrow()
    expect(normalizeClaudeQuota(raw)?.windows).toHaveLength(1)
  })

  it("ignores session cost/duration totals entirely — not part of the generic contract", () => {
    const raw = makeRaw({
      session: { ...SESSION_STUB, total_cost_usd: 12.34 },
      rate_limits: { five_hour: { utilization: 5, resets_at: null } },
    })
    const snapshot = normalizeClaudeQuota(raw)
    expect(snapshot).not.toHaveProperty("session")
    expect(snapshot).not.toHaveProperty("total_cost_usd")
  })
})
