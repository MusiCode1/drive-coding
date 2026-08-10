/**
 * state.test.ts — TDD tests for GET /api/agents/:id/state (C5).
 *
 * Testing: tdd (brief §C5)
 *
 * Tests:
 *   - 404 if agent not found (getHost returns undefined)
 *   - 200 with host.state as JSON snapshot
 *   - version is included in the response
 */

import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import type { SessionState } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import type { AgentSessionRegistry } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { registerStateRoute } from "./state.js"

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...createInitialSessionState({ sessionId: null }), ...overrides }
}

function makeMockHost(state: SessionState): ExtendedSessionHost {
  return {
    state,
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
    agentCapabilities: {},
  }
}

function makeMockRegistry(host?: ExtendedSessionHost): AgentSessionRegistry {
  return {
    getHost: vi.fn().mockReturnValue(host),
    getOrCreateHost: vi.fn().mockResolvedValue(host ? { host, broadcaster: { subscribe: vi.fn(), unsubscribe: vi.fn() } } : undefined),
    getBroadcaster: vi.fn().mockReturnValue(undefined),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  }
}

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerStateRoute(app, registry)
  return app
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/agents/:id/state", () => {
  describe("404 when agent not found", () => {
    it("returns 404 if registry.getHost returns undefined", async () => {
      const registry = makeMockRegistry()
      const app = makeApp(registry)

      const res = await app.request("/api/agents/missing/state")
      expect(res.status).toBe(404)
    })
  })

  describe("snapshot response", () => {
    it("returns 200 with the current host.state as JSON", async () => {
      const state = makeMockState({ title: "My Session", version: 42 })
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/state")
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.title).toBe("My Session")
      expect(json.version).toBe(42)
    })

    it("returns application/json content-type", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      const res = await app.request("/api/agents/agent-1/state")
      expect(res.headers.get("content-type")).toContain("application/json")
    })

    it("calls getHost with the agentId from URL", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host)
      const app = makeApp(registry)

      await app.request("/api/agents/my-agent/state")
      expect(registry.getHost).toHaveBeenCalledWith("my-agent")
    })
  })
})
