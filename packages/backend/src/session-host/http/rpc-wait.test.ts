/**
 * rpc-wait.test.ts — TDD tests for parseWaitMs + raceKeepRunning (slice rpc-wait C0).
 *
 * Testing: tdd (brief §6 Commit 0)
 */

import { describe, expect, it, vi } from "vitest"
import { MAX_RPC_WAIT_MS, parseWaitMs, raceKeepRunning } from "./rpc-wait.js"

describe("parseWaitMs", () => {
  it.each([
    [undefined, null],
    [null, null],
    [0, null],
  ])("absent/zero → null (%j)", (raw, expected) => {
    expect(parseWaitMs(raw)).toBe(expected)
  })

  it.each([
    [1, 1],
    [60_000, 60_000],
    [MAX_RPC_WAIT_MS, MAX_RPC_WAIT_MS],
  ])("valid integer in range → number (%j)", (raw, expected) => {
    expect(parseWaitMs(raw)).toBe(expected)
  })

  it.each([
    [60_001, "invalid"],
    [-1, "invalid"],
    [1.5, "invalid"],
    ["5000", "invalid"],
    [NaN, "invalid"],
    [true, "invalid"],
    [{}, "invalid"],
  ])("out of range / non-integer / non-number → invalid (%j)", (raw, expected) => {
    expect(parseWaitMs(raw)).toBe(expected)
  })
})

describe("raceKeepRunning", () => {
  it("work resolves before timeout → resolved outcome", async () => {
    const onLate = vi.fn()
    const result = await raceKeepRunning(Promise.resolve("ok"), 50, onLate)
    expect(result).toEqual({ outcome: "resolved", value: "ok" })
    expect(onLate).not.toHaveBeenCalled()
  })

  it("work rejects before timeout → rejected outcome", async () => {
    const onLate = vi.fn()
    const err = Object.assign(new Error("turn failed"), { code: -32601 })
    const result = await raceKeepRunning(Promise.reject(err), 50, onLate)
    expect(result).toEqual({ outcome: "rejected", error: err })
    expect(onLate).not.toHaveBeenCalled()
  })

  it("timeout before work settles → timedOut outcome", async () => {
    const onLate = vi.fn()
    const never = new Promise<string>(() => {})
    const result = await raceKeepRunning(never, 20, onLate)
    expect(result).toEqual({ outcome: "timedOut" })
    expect(onLate).not.toHaveBeenCalled()
  })

  it("work rejects after timeout → onLateSettle called, zero unhandledRejection", async () => {
    const onLate = vi.fn()
    let rejectWork!: (reason: unknown) => void
    const work = new Promise<void>((_, reject) => {
      rejectWork = reject
    })

    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on("unhandledRejection", onRejection)

    try {
      const result = await raceKeepRunning(work, 20, onLate)
      expect(result).toEqual({ outcome: "timedOut" })

      const lateErr = Object.assign(new Error("late turn failed"), { code: -32000 })
      rejectWork(lateErr)
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onLate).toHaveBeenCalledWith(lateErr)
      expect(rejections).toHaveLength(0)
    } finally {
      process.off("unhandledRejection", onRejection)
    }
  })

  it("work resolves after timeout → onLateSettle NOT called (late resolve swallowed)", async () => {
    const onLate = vi.fn()
    let resolveWork!: (value: string) => void
    const work = new Promise<string>((resolve) => {
      resolveWork = resolve
    })

    const result = await raceKeepRunning(work, 20, onLate)
    expect(result).toEqual({ outcome: "timedOut" })

    resolveWork("late")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onLate).not.toHaveBeenCalled()
  })
})
