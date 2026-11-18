/**
 * session-init.fallback.test.ts — a stale session id must not cost the agent.
 *
 * Before the fallback, a failed `session/load` propagated, host creation rolled
 * back, and the agent became unopenable while its process stayed alive and
 * healthy — an entry in the list that errors on every click.
 */

import { describe, expect, it, vi } from "vitest"
import { initSession } from "../src/session-host/session-init.js"

const base = { cwd: "/tmp", mcpServers: [] }

describe("initSession", () => {
  it("cold when there is no session id to reattach to", async () => {
    const host = { loadSession: vi.fn(), newSession: vi.fn(async () => ({})) }
    expect(await initSession(host, base, undefined, "a")).toBe("cold")
    expect(host.loadSession).not.toHaveBeenCalled()
    expect(host.newSession).toHaveBeenCalledOnce()
  })

  it("warm when a session id is remembered", async () => {
    const host = { loadSession: vi.fn(async () => ({})), newSession: vi.fn() }
    expect(await initSession(host, base, "s-1", "a")).toBe("warm")
    expect(host.loadSession).toHaveBeenCalledWith({ ...base, sessionId: "s-1" })
    expect(host.newSession).not.toHaveBeenCalled()
  })

  it("🔴 a stale session id degrades to a fresh session, not to a dead agent", async () => {
    // Reachable for ordinary reasons: the CLI restarted internally, the session
    // expired, the adapter was upgraded under us.
    const host = {
      loadSession: vi.fn(async () => {
        throw new Error("no such session")
      }),
      newSession: vi.fn(async () => ({})),
    }
    expect(await initSession(host, base, "gone", "a")).toBe("cold-after-warm-failed")
    expect(host.newSession).toHaveBeenCalledOnce()
  })

  it("🔴 a cold failure still propagates — there is no session at all then", async () => {
    // The fallback covers a lost transcript, not a broken agent.
    const host = {
      loadSession: vi.fn(),
      newSession: vi.fn(async () => {
        throw new Error("agent is not answering")
      }),
    }
    await expect(initSession(host, base, undefined, "a")).rejects.toThrow(/not answering/)
  })

  it("a warm failure followed by a cold failure propagates the cold one", async () => {
    const host = {
      loadSession: vi.fn(async () => {
        throw new Error("stale")
      }),
      newSession: vi.fn(async () => {
        throw new Error("also broken")
      }),
    }
    await expect(initSession(host, base, "s", "a")).rejects.toThrow(/also broken/)
  })
})
