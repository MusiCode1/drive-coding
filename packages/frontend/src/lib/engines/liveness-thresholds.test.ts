/**
 * liveness-thresholds.test.ts — TDD ל-liveness-thresholds.ts (Commit 4ב).
 *
 * Testing: tdd (brief §Commit 4ב)
 */

import { describe, expect, it } from "vitest"
import {
  checkThresholdOrder,
  PRESENCE_BANNER_DELAY_MS,
  PRESENCE_INTERVAL_MS,
  SERVER_KEEPALIVE_MS,
  SSE_WATCHDOG_THRESHOLD_MS,
  STALL_HARD_CAP_MS,
  STALL_NOTICE_MS,
} from "./liveness-thresholds.js"

const VALID = {
  serverKeepaliveMs: 30_000,
  sseWatchdogThresholdMs: 75_000,
  stallNoticeMs: 90_000,
  stallHardCapMs: 600_000,
  presenceBannerDelayMs: 5_000,
  presenceIntervalMs: 12_000,
}

describe("liveness-thresholds — constants", () => {
  it("SERVER_KEEPALIVE_MS is imported from core's stream-alive.ts, not duplicated", () => {
    expect(SERVER_KEEPALIVE_MS).toBe(30_000)
  })

  it("SSE_WATCHDOG_THRESHOLD_MS is 2.5x the server keepalive", () => {
    expect(SSE_WATCHDOG_THRESHOLD_MS).toBe(SERVER_KEEPALIVE_MS * 2.5)
    expect(SSE_WATCHDOG_THRESHOLD_MS).toBe(75_000)
  })

  it("all thresholds pass their own order-check — the module throws at import time otherwise", () => {
    const result = checkThresholdOrder({
      serverKeepaliveMs: SERVER_KEEPALIVE_MS,
      sseWatchdogThresholdMs: SSE_WATCHDOG_THRESHOLD_MS,
      stallNoticeMs: STALL_NOTICE_MS,
      stallHardCapMs: STALL_HARD_CAP_MS,
      presenceBannerDelayMs: PRESENCE_BANNER_DELAY_MS,
      presenceIntervalMs: PRESENCE_INTERVAL_MS,
    })
    expect(result).toEqual({ ok: true })
  })
})

describe("checkThresholdOrder — fails on a wrongly-ordered threshold", () => {
  it("ok:true on the real, valid thresholds", () => {
    expect(checkThresholdOrder(VALID)).toEqual({ ok: true })
  })

  it("fails when sseWatchdogThresholdMs <= serverKeepaliveMs (watchdog would fire on healthy keepalive)", () => {
    const result = checkThresholdOrder({ ...VALID, sseWatchdogThresholdMs: 30_000 })
    expect(result.ok).toBe(false)
  })

  it("fails when sseWatchdogThresholdMs is LESS than serverKeepaliveMs", () => {
    const result = checkThresholdOrder({ ...VALID, sseWatchdogThresholdMs: 10_000 })
    expect(result.ok).toBe(false)
  })

  it("fails when stallNoticeMs >= stallHardCapMs (notice must fire before give-up)", () => {
    const result = checkThresholdOrder({ ...VALID, stallNoticeMs: 600_000 })
    expect(result.ok).toBe(false)
  })

  it("fails when presenceBannerDelayMs is absurdly larger than presenceIntervalMs", () => {
    const result = checkThresholdOrder({ ...VALID, presenceBannerDelayMs: 999_999 })
    expect(result.ok).toBe(false)
  })
})
