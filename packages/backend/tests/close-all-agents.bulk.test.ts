/**
 * close-all-agents.bulk.test.ts — "stop everything" has to actually stop everything.
 *
 * The failure shape is the whole point: one agent refusing to die must not save
 * the rest, and the caller has to learn *which* one refused.
 */

import { describe, expect, it, vi } from "vitest"
import { closeAllAgents } from "../src/app/close-all-agents.js"

const list =
  (...ids: string[]) =>
  async () =>
    ids.map((id) => ({ id }))

describe("closeAllAgents", () => {
  it("closes every agent and names them", async () => {
    const closeOne = vi.fn(async () => {})
    const res = await closeAllAgents(list("a", "b", "c"), closeOne)
    expect(res.closed.sort()).toEqual(["a", "b", "c"])
    expect(res.failed).toEqual([])
    expect(closeOne).toHaveBeenCalledTimes(3)
  })

  it("🔴 one failure does not spare the others", async () => {
    // A sequential loop that threw would leave everything after "b" running —
    // the opposite of what this operation is for.
    const closeOne = vi.fn(async (id: string) => {
      if (id === "b") throw new Error("stuck")
    })
    const res = await closeAllAgents(list("a", "b", "c"), closeOne)
    expect(res.closed.sort()).toEqual(["a", "c"])
    expect(res.failed).toEqual([{ id: "b", error: "stuck" }])
    expect(closeOne).toHaveBeenCalledTimes(3)
  })

  it("🔴 reports which one failed, not just how many", async () => {
    const res = await closeAllAgents(list("x"), async () => {
      throw new Error("unit would not stop")
    })
    expect(res.failed[0]).toEqual({ id: "x", error: "unit would not stop" })
  })

  it("a non-Error rejection is still reported readably", async () => {
    const res = await closeAllAgents(list("x"), async () => {
      throw "just a string"
    })
    expect(res.failed[0]?.error).toBe("just a string")
  })

  it("an empty registry is a no-op, not an error", async () => {
    const closeOne = vi.fn()
    const res = await closeAllAgents(list(), closeOne)
    expect(res).toEqual({ closed: [], failed: [] })
    expect(closeOne).not.toHaveBeenCalled()
  })
})
