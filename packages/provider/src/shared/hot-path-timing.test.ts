/**
 * hot-path-timing.test.ts — unit tests for markStart / logIfSlow.
 * TDD: red → green.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── spy on pino-flavoured log.warn ──────────────────────────────────────────
// vi.hoisted runs before module resolution, so we can define the mock object
// here and reference it safely from vi.mock factory.
const { mockLog } = vi.hoisted(() => ({
  mockLog: { warn: vi.fn() },
}))

vi.mock("@drive-coding/core/log", () => ({
  createLogger: () => mockLog,
}))

// Import AFTER vi.mock so the mock is in place when hot-path-timing.ts loads.
import { logIfSlow, markStart } from "./hot-path-timing.js"

beforeEach(() => {
  mockLog.warn.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── tests ────────────────────────────────────────────────────────────────────

describe("markStart", () => {
  it("returns a number (performance.now timestamp)", () => {
    const t = markStart()
    expect(typeof t).toBe("number")
    expect(t).toBeGreaterThan(0)
  })
})

describe("logIfSlow — below threshold (default 50ms)", () => {
  it("does NOT log when duration is well below 50ms", () => {
    const t = markStart()
    // Immediate call — virtually 0ms elapsed.
    logIfSlow("parse", t, { bytes: 100 })
    expect(mockLog.warn).not.toHaveBeenCalled()
  })
})

describe("logIfSlow — above threshold", () => {
  it("logs warn with op/durationMs/meta when duration is clearly above threshold", () => {
    // Pass a startedAt that is 60ms in the past → well above the default 50ms threshold.
    const fakeStart = performance.now() - 60
    logIfSlow("stringify", fakeStart, { bytes: 2048 })
    expect(mockLog.warn).toHaveBeenCalledOnce()
    const [obj, msg] = mockLog.warn.mock.calls[0] as [Record<string, unknown>, string]
    expect(msg).toBe("slow hot-path op")
    expect(obj.op).toBe("stringify")
    expect(typeof obj.durationMs).toBe("number")
    expect(obj.bytes).toBe(2048)
  })
})

describe("logIfSlow — overhead", () => {
  it("happy-path only calls performance.now() twice (no log, no alloc)", () => {
    const spy = vi.spyOn(performance, "now")
    const t = markStart()
    logIfSlow("readline", t)
    // markStart calls now() once; logIfSlow calls it once more.
    expect(spy).toHaveBeenCalledTimes(2)
    // No warn emitted.
    expect(mockLog.warn).not.toHaveBeenCalled()
  })
})
