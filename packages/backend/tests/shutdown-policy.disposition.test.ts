/**
 * shutdown-policy.disposition.test.ts — what a shutdown does to live agents.
 *
 * The default is the assertion that matters: a `systemctl restart` must not
 * stop anything, because there is no one there to ask and the backend is back
 * in seconds.
 */

import { describe, expect, it, vi } from "vitest"
import {
  applyShutdownDisposition,
  shutdownAgents,
  shutdownDisposition,
} from "../src/agents/shutdown-policy.js"

describe("shutdownDisposition", () => {
  it("🔴 SIGTERM leaves agents running — there is nobody to ask", () => {
    // systemctl restart arrives this way, with no tty and TimeoutStopSec ticking.
    expect(shutdownDisposition({ signal: "SIGTERM", env: {} })).toBe("leave-running")
    expect(shutdownDisposition({ signal: "SIGTERM", env: {}, isTty: true })).toBe("leave-running")
  })

  it("an interactive SIGINT asks — there is a human at the terminal", () => {
    expect(shutdownDisposition({ signal: "SIGINT", env: {}, isTty: true })).toBe("ask")
    expect(shutdownDisposition({ signal: "SIGINT", env: {}, isTty: false })).toBe("leave-running")
  })

  it("SHUTDOWN_KILLS_AGENTS forces the old behaviour, and can force the new one", () => {
    for (const v of ["1", "true", "TRUE"]) {
      expect(
        shutdownDisposition({ signal: "SIGINT", env: { SHUTDOWN_KILLS_AGENTS: v }, isTty: true }),
      ).toBe("kill-all")
    }
    for (const v of ["0", "false"]) {
      expect(
        shutdownDisposition({ signal: "SIGINT", env: { SHUTDOWN_KILLS_AGENTS: v }, isTty: true }),
      ).toBe("leave-running")
    }
  })
})

describe("applyShutdownDisposition", () => {
  it("🔴 stops nothing on the default path", async () => {
    const stop = vi.fn(() => true)
    const decision = await applyShutdownDisposition(
      ["a", "b"],
      { signal: "SIGTERM", env: {} },
      stop,
    )
    expect(decision).toBe("leave-running")
    expect(stop).not.toHaveBeenCalled()
  })

  it("stops every unit when told to", async () => {
    const stop = vi.fn(() => true)
    const decision = await applyShutdownDisposition(
      ["a", "b"],
      { signal: "SIGTERM", env: { SHUTDOWN_KILLS_AGENTS: "1" } },
      stop,
    )
    expect(decision).toBe("kill-all")
    expect(stop.mock.calls.map((c) => c[0])).toEqual(["a", "b"])
  })

  it("does nothing at all when no agent is live", async () => {
    const stop = vi.fn(() => true)
    expect(
      await applyShutdownDisposition([], { signal: "SIGINT", env: {}, isTty: true }, stop),
    ).toBe("leave-running")
    expect(stop).not.toHaveBeenCalled()
  })
})

describe("shutdownAgents", () => {
  it("closes every live connection, then applies policy", async () => {
    const closed: string[] = []
    const registry = {
      list: () => ["x", "y"],
      close: async (id: string) => {
        closed.push(id)
      },
    }
    const stop = vi.fn(() => true)

    await shutdownAgents(registry, { sig: "SIGTERM" }, stop)

    expect(closed.sort()).toEqual(["x", "y"])
    // 🔴 close() alone is a disconnect for a sidecar. Default policy adds nothing.
    expect(stop).not.toHaveBeenCalled()
  })

  it("one connection failing to close does not abort the rest", async () => {
    const closed: string[] = []
    const registry = {
      list: () => ["ok-1", "boom", "ok-2"],
      close: async (id: string) => {
        if (id === "boom") throw new Error("nope")
        closed.push(id)
      },
    }
    await expect(shutdownAgents(registry, { sig: "SIGTERM" }, () => true)).resolves.toBeUndefined()
    expect(closed.sort()).toEqual(["ok-1", "ok-2"])
  })
})
