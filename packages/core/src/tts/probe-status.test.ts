/**
 * probe-status.test.ts — TDD tests for interpretProbeStatus.
 *
 * Slice: tts-provider-availability, Commit 0.
 */

import { describe, expect, it } from "vitest"
import { interpretProbeStatus } from "./probe-status.js"

describe("interpretProbeStatus", () => {
  // 200-299 → available
  it("200 → available ok", () => {
    expect(interpretProbeStatus(200)).toEqual({ available: true, reason: "ok" })
  })

  it("201 → available ok", () => {
    expect(interpretProbeStatus(201)).toEqual({ available: true, reason: "ok" })
  })

  it("299 → available ok", () => {
    expect(interpretProbeStatus(299)).toEqual({ available: true, reason: "ok" })
  })

  // 401 → no-key
  it("401 → unavailable no-key", () => {
    expect(interpretProbeStatus(401)).toEqual({ available: false, reason: "no-key" })
  })

  // 403 → forbidden
  it("403 → unavailable forbidden", () => {
    expect(interpretProbeStatus(403)).toEqual({ available: false, reason: "forbidden" })
  })

  // 429 → quota
  it("429 → unavailable quota", () => {
    expect(interpretProbeStatus(429)).toEqual({ available: false, reason: "quota" })
  })

  // null → error (network/timeout)
  it("null → unavailable error", () => {
    expect(interpretProbeStatus(null)).toEqual({ available: false, reason: "error" })
  })

  // other 4xx → error
  it("400 → unavailable error", () => {
    expect(interpretProbeStatus(400)).toEqual({ available: false, reason: "error" })
  })

  it("404 → unavailable error", () => {
    expect(interpretProbeStatus(404)).toEqual({ available: false, reason: "error" })
  })

  // 5xx → error
  it("500 → unavailable error", () => {
    expect(interpretProbeStatus(500)).toEqual({ available: false, reason: "error" })
  })

  it("503 → unavailable error", () => {
    expect(interpretProbeStatus(503)).toEqual({ available: false, reason: "error" })
  })
})
