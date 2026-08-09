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
