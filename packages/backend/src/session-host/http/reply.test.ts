/**
 * reply.test.ts — TDD tests for POST /api/agents/:id/reply (C4).
 *
 * Testing: tdd (brief §C4)
 *
 * Tests:
 *   - 404 if agent not in registry (getHost returns undefined)
 *   - 200 OK for permission reply
 *   - 200 OK for elicitation reply
 *   - kind discriminator: "permission" → respondPermission, "elicitation" → respondElicitation
 *   - requestId + result passed correctly
 *   - silent no-op on unknown requestId (no 404, respond*() is void)
 *   - 400 for unknown kind
 *
 * ─── slice session-host-pending-surface C4: comment-only — shared requestId counter ───
 */

import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import type { AgentSessionRegistry } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { registerReplyRoute } from "./reply.js"

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockHost(): ExtendedSessionHost {
  return {
    state: { version: 0 } as ExtendedSessionHost["state"],
    patches: new ReadableStream({ start() {} }),
    prompt: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    cancel: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setConfigOption: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({}),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    agentCapabilities: {},
  }
}

function makeMockRegistry(host?: ExtendedSessionHost): AgentSessionRegistry {
  return {
    getHost: vi.fn().mockReturnValue(host),
    isHeld: vi.fn().mockReturnValue(Boolean(host)),
    getOrCreateHost: vi
      .fn()
      .mockResolvedValue(
        host ? { host, broadcaster: { subscribe: vi.fn(), unsubscribe: vi.fn() } } : undefined,
      ),
    getCwd: vi.fn().mockReturnValue(undefined),
    getBroadcaster: vi.fn().mockReturnValue(undefined),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  }
}

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerReplyRoute(app, registry)
  return app
}

async function postReply(app: Hono, agentId: string, body: unknown): Promise<Response> {
  return app.request(`/api/agents/${agentId}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agents/:id/reply", () => {
  describe("404 when agent not found", () => {
    it("returns 404 if registry.getHost returns undefined", async () => {
      const registry = makeMockRegistry() // host is undefined
      const app = makeApp(registry)

      const res = await postReply(app, "missing-agent", {
        kind: "permission",
        requestId: 0,
        result: { outcome: { outcome: "allow" } },
      })
      expect(res.status).toBe(404)
    })

    it("calls getHost with the agentId from URL", async () => {
      const registry = makeMockRegistry()
      const app = makeApp(registry)

      await postReply(app, "specific-agent", { kind: "permission", requestId: 0, result: {} })
      expect(registry.getHost).toHaveBeenCalledWith("specific-agent")
    })
  })

  describe("permission kind", () => {
    it("returns 200 OK for permission reply", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      const res = await postReply(app, "agent-1", {
        kind: "permission",
        requestId: 0,
        result: { outcome: { outcome: "allow" } },
      })
      expect(res.status).toBe(200)
    })

    it("calls host.respondPermission with requestId + result", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      const result = { outcome: { outcome: "allow" } }
      await postReply(app, "agent-1", {
        kind: "permission",
        requestId: 3,
        result,
      })
      expect(host.respondPermission).toHaveBeenCalledWith(3, result)
    })

    it("calls respondPermission (not respondElicitation) for kind=permission", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      await postReply(app, "agent-1", {
        kind: "permission",
        requestId: 1,
        result: { outcome: { outcome: "deny" } },
      })
      expect(host.respondPermission).toHaveBeenCalledTimes(1)
      expect(host.respondElicitation).not.toHaveBeenCalled()
    })
  })

  describe("elicitation kind", () => {
    it("returns 200 OK for elicitation reply", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      const res = await postReply(app, "agent-1", {
        kind: "elicitation",
        requestId: 0,
        result: { action: "submit", fields: { name: "Alice" } },
      })
      expect(res.status).toBe(200)
    })

    it("calls host.respondElicitation with requestId + result", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      const result = { action: "submit", fields: { name: "Alice" } }
      await postReply(app, "agent-1", {
        kind: "elicitation",
        requestId: 2,
        result,
      })
      expect(host.respondElicitation).toHaveBeenCalledWith(2, result)
    })

    it("calls respondElicitation (not respondPermission) for kind=elicitation", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      await postReply(app, "agent-1", {
        kind: "elicitation",
        requestId: 0,
        result: { action: "cancel" },
      })
      expect(host.respondElicitation).toHaveBeenCalledTimes(1)
      expect(host.respondPermission).not.toHaveBeenCalled()
    })
  })

  describe("kind discriminator", () => {
    it("requestId 0 for permission uses respondPermission (not respondElicitation)", async () => {
      // slice session-host-pending-surface C4: requestId is now a single shared
      // counter (unique across both kinds) — but `kind` is still required here,
      // since permission/elicitation are two separate PendingRequests maps and
      // `kind` is what routes between them, not what disambiguates the id.
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      await postReply(app, "agent-1", {
        kind: "permission",
        requestId: 0,
        result: { outcome: { outcome: "allow" } },
      })
      expect(host.respondPermission).toHaveBeenCalledWith(0, expect.anything())
      expect(host.respondElicitation).not.toHaveBeenCalled()
    })

    it("requestId 0 for elicitation uses respondElicitation (not respondPermission)", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      await postReply(app, "agent-1", {
        kind: "elicitation",
        requestId: 0,
        result: { action: "cancel" },
      })
      expect(host.respondElicitation).toHaveBeenCalledWith(0, expect.anything())
      expect(host.respondPermission).not.toHaveBeenCalled()
    })
  })

  describe("silent no-op for unknown requestId", () => {
    it("returns 200 even for an unknown requestId (respond*() is void)", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      // requestId 999 doesn't exist — respond*() is a no-op (no error)
      const res = await postReply(app, "agent-1", {
        kind: "permission",
        requestId: 999,
        result: { outcome: { outcome: "allow" } },
      })
      expect(res.status).toBe(200)
    })
  })

  describe("unknown kind", () => {
    it("returns 400 for an unknown kind", async () => {
      const host = makeMockHost()
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      const res = await postReply(app, "agent-1", {
        kind: "unknown-kind",
        requestId: 0,
        result: {},
      })
      expect(res.status).toBe(400)
    })
  })
})
