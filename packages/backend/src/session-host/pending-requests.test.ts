/**
 * pending-requests.test.ts — TDD tests for PendingRequests (C3).
 *
 * Testing: tdd (brief §C3)
 *
 * Tests:
 *   - request(id) → creates a pending promise
 *   - respond(id, result) → resolves the promise
 *   - timeout → rejects with default after X ms
 *   - respond after timeout → ignored (no double-resolve)
 *   - respond for unknown id → ignored safely
 *   - multiple concurrent requests, each resolved independently
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPendingRequests } from "./pending-requests.js"

describe("PendingRequests", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe("request + respond", () => {
    it("respond(id, result) resolves the pending promise with the result", async () => {
      const pending = createPendingRequests({ timeoutMs: 5000 })

      const promise = pending.request(42)
      pending.respond(42, { action: "allow" })

      const result = await promise
      expect(result).toEqual({ action: "allow" })
    })

    it("respond for an unknown id is a no-op (no throw)", () => {
      const pending = createPendingRequests({ timeoutMs: 5000 })
      expect(() => pending.respond(999, { action: "deny" })).not.toThrow()
    })
  })

  describe("timeout", () => {
    it("rejects with a timeout error when timeoutMs elapses without respond", async () => {
      const pending = createPendingRequests({ timeoutMs: 100 })

      const promise = pending.request(1)

      vi.advanceTimersByTime(101)

      await expect(promise).rejects.toThrow(/timeout/i)
    })

    it("does not reject before timeoutMs", async () => {
      const pending = createPendingRequests({ timeoutMs: 1000 })

      const promise = pending.request(2)
      vi.advanceTimersByTime(500)

      // Should still be pending — use a race to check
      let resolved = false
      promise.then(() => { resolved = true }).catch(() => { resolved = true })

      // Flush microtasks
      await Promise.resolve()
      expect(resolved).toBe(false)

      // Clean up
      pending.respond(2, { action: "allow" })
      await promise
    })

    it("ignores respond() after timeout (no double-resolve)", async () => {
      const pending = createPendingRequests({ timeoutMs: 50 })

      const promise = pending.request(3)
      vi.advanceTimersByTime(51)

      // Let the rejection propagate
      await expect(promise).rejects.toThrow(/timeout/i)

      // This should not throw or cause unhandled rejection
      expect(() => pending.respond(3, { action: "allow" })).not.toThrow()
    })
  })

  describe("multiple concurrent requests", () => {
    it("resolves each request independently by requestId", async () => {
      const pending = createPendingRequests({ timeoutMs: 5000 })

      const p1 = pending.request(10)
      const p2 = pending.request(20)
      const p3 = pending.request(30)

      pending.respond(20, { action: "deny" })
      pending.respond(10, { action: "allow" })

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toEqual({ action: "allow" })
      expect(r2).toEqual({ action: "deny" })

      // p3 still pending; clean up
      pending.respond(30, { action: "allow" })
      await p3
    })
  })

  describe("default value option", () => {
    it("returns the default value instead of throwing on timeout when provided", async () => {
      const pending = createPendingRequests({
        timeoutMs: 50,
        defaultValue: { action: "deny" as const },
      })

      const promise = pending.request(5)
      vi.advanceTimersByTime(51)

      const result = await promise
      expect(result).toEqual({ action: "deny" })
    })
  })
})

// ─── slice handoff-foundations C2: respondAll() ───────────────────────────────

describe("respondAll() (handoff-foundations C2)", () => {
  it("resolves all three concurrent pending requests with the given value", async () => {
    const pending = createPendingRequests({ timeoutMs: 5000 })

    const p1 = pending.request(10)
    const p2 = pending.request(20)
    const p3 = pending.request(30)

    pending.respondAll({ action: "deny" })

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1).toEqual({ action: "deny" })
    expect(r2).toEqual({ action: "deny" })
    expect(r3).toEqual({ action: "deny" })
  })

  it("clears timers (no timeout fires after respondAll)", async () => {
    vi.useFakeTimers()
    const pending = createPendingRequests({ timeoutMs: 100 })

    const p1 = pending.request(1)
    const p2 = pending.request(2)

    pending.respondAll({ action: "cancel" })

    await Promise.all([p1, p2])

    // Advance past timeout — no unhandled rejection
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
  })

  it("calling respondAll on an empty map is a no-op (idempotent)", () => {
    const pending = createPendingRequests({ timeoutMs: 5000 })

    expect(() => pending.respondAll({ action: "cancel" })).not.toThrow()
  })

  it("respond after respondAll for the same id is a no-op (no double-resolve)", async () => {
    const pending = createPendingRequests({ timeoutMs: 5000 })

    const p1 = pending.request(42)
    pending.respondAll({ action: "deny" })
    const result = await p1

    expect(result).toEqual({ action: "deny" })

    // respond for the same id should be a no-op
    expect(() => pending.respond(42, { action: "allow" })).not.toThrow()
  })
})
