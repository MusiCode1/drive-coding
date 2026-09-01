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

import type { SessionState } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
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
    emitExtNotification: vi.fn(),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    agentCapabilities: {},
    getTurnStartedAt: () => 0,
    getStallReported: () => false,
    markStallReported: () => {},
  }
}

function makeMockRegistry(host?: ExtendedSessionHost): AgentSessionRegistry {
  // slice host-result-reason C1: state.ts route uses getHost() only (not
  // getOrCreateHost), so this value is unused at runtime — kept type-correct
  // for hygiene (vi.fn() is untyped, so a wrong shape here would pass silently).
  const result: HostResult = host
    ? {
        ok: true,
        entry: { host, broadcaster: { subscribe: vi.fn(), unsubscribe: vi.fn(), close: vi.fn() } },
      }
    : { ok: false, reason: "not-found" }
  return {
    getHost: vi.fn().mockReturnValue(host),
    isHeld: vi.fn().mockReturnValue(Boolean(host)),
    getOrCreateHost: vi.fn().mockResolvedValue(result),
    getCwd: vi.fn(),
    getCliKind: vi.fn(),
    getEpoch: vi.fn().mockReturnValue(0),
    touchConnection: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue(null),
    getConnectionCount: vi.fn().mockReturnValue(0),
    stop: vi.fn(),
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

      // `res.json()` הוא unknown אחרי המיזוג מ-dev (טיפוסי Bun מחמירים יותר) —
      // הצהרה מפורשת במקום גישה על unknown.
      const json = (await res.json()) as { title?: string; version?: number }
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
