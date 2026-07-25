/**
 * subscription.test.ts — TDD for interpretSubscription.
 *
 * Slice: tts-quota-subscription, Commit 0.
 */

import { describe, expect, it } from "vitest"
import { interpretSubscription } from "./subscription.js"

describe("interpretSubscription", () => {
  it("free_disabled status → exhausted", () => {
    const result = interpretSubscription({
      characterCount: 0,
      characterLimit: 10_000,
      status: "free_disabled",
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })

  it("characterCount >= characterLimit → exhausted", () => {
    const result = interpretSubscription({
      characterCount: 10_000,
      characterLimit: 10_000,
      status: "active",
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })

  it("characterCount > characterLimit → exhausted", () => {
    const result = interpretSubscription({
      characterCount: 12_000,
      characterLimit: 10_000,
      status: "active",
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })

  it("characterCount < characterLimit → not exhausted", () => {
    const result = interpretSubscription({
      characterCount: 5_000,
      characterLimit: 10_000,
      status: "active",
    })
    expect(result).toEqual({ exhausted: false, reason: "ok" })
  })

  it("trialing with remaining quota → not exhausted", () => {
    const result = interpretSubscription({
      characterCount: 1_000,
      characterLimit: 10_000,
      status: "trialing",
    })
    expect(result).toEqual({ exhausted: false, reason: "ok" })
  })

  it("past_due (may still work) → not exhausted", () => {
    const result = interpretSubscription({
      characterCount: 5_000,
      characterLimit: 10_000,
      status: "past_due",
    })
    expect(result).toEqual({ exhausted: false, reason: "ok" })
  })

  it("characterLimit = 0 (unlimited/enterprise guard) → not exhausted", () => {
    // characterLimit=0 means guard prevents division/comparison trap
    const result = interpretSubscription({
      characterCount: 0,
      characterLimit: 0,
      status: "active",
    })
    expect(result).toEqual({ exhausted: false, reason: "ok" })
  })

  it("negative characterCount (defensive/corrupt data) → not exhausted", () => {
    const result = interpretSubscription({
      characterCount: -1,
      characterLimit: 10_000,
      status: "active",
    })
    expect(result).toEqual({ exhausted: false, reason: "ok" })
  })

  it("unknown status with remaining quota → not exhausted (optimistic)", () => {
    const result = interpretSubscription({
      characterCount: 0,
      characterLimit: 10_000,
      status: "some_future_status",
    })
    expect(result).toEqual({ exhausted: false, reason: "ok" })
  })

  it("free_disabled overrides even zero count", () => {
    // free_disabled is always exhausted regardless of counts
    const result = interpretSubscription({
      characterCount: 0,
      characterLimit: 0,
      status: "free_disabled",
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })

  // ─── effective-limit (tts-quota-refine) ────────────────────────────────────

  it("canExtend+maxExtension: count between base and effective → NOT exhausted (overage allowed)", () => {
    // base=100_000, extension=100_000 → effective=200_000
    // count=150_000 is between base and effective → not exhausted
    const result = interpretSubscription({
      characterCount: 150_000,
      characterLimit: 100_000,
      status: "active",
      canExtend: true,
      maxExtension: 100_000,
    })
    expect(result).toEqual({ exhausted: false, reason: "ok" })
  })

  it("canExtend+maxExtension: count >= effective → exhausted", () => {
    // base=100_000, extension=100_000 → effective=200_000; count=200_000 → exhausted
    const result = interpretSubscription({
      characterCount: 200_000,
      characterLimit: 100_000,
      status: "active",
      canExtend: true,
      maxExtension: 100_000,
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })

  it("canExtend=false: count between base and notional extension → exhausted (falls back to base)", () => {
    // canExtend=false → effective=base=100_000; count=150_000 >= base → exhausted
    const result = interpretSubscription({
      characterCount: 150_000,
      characterLimit: 100_000,
      status: "active",
      canExtend: false,
      maxExtension: 100_000,
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })

  it("maxExtension=0: falls back to base limit", () => {
    // maxExtension=0 → effective=base=100_000; count=100_000 → exhausted
    const result = interpretSubscription({
      characterCount: 100_000,
      characterLimit: 100_000,
      status: "active",
      canExtend: true,
      maxExtension: 0,
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })

  it("canExtend+maxExtension absent (undefined): behaves as before (base limit)", () => {
    // no extension fields → effective=base; count=100_000 → exhausted
    const result = interpretSubscription({
      characterCount: 100_000,
      characterLimit: 100_000,
      status: "active",
    })
    expect(result).toEqual({ exhausted: true, reason: "quota" })
  })
})
