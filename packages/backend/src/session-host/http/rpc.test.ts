/**
 * rpc.test.ts — TDD tests for POST /api/agents/:id/rpc (C3).
 *
 * Testing: tdd (brief §C3)
 *
 * Tests:
 *   - 404 if connection not found
 *   - 202 Accepted with {version} for each supported method
 *   - prompt: calls host.prompt with sessionId + content (+ optional meta)
 *   - cancel: calls host.cancel
 *   - setMode: calls host.setMode
 *   - setConfigOption: calls host.setConfigOption
 *   - extMethod: calls host.extMethod
 *   - 400 for unknown method
 */

import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import type { SessionState } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import type { AgentSessionRegistry } from "../registry.js"
import type { PatchesBroadcaster } from "../patches-broadcaster.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { registerRpcRoute } from "./rpc.js"

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockState(version = 3): SessionState {
  return { ...createInitialSessionState({ sessionId: null }), version }
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
    extMethod: vi.fn().mockResolvedValue({ result: "ok" }),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
  }
}

function makeMockBroadcaster(): PatchesBroadcaster {
  return {
    subscribe: vi.fn().mockReturnValue(new ReadableStream()),
    unsubscribe: vi.fn(),
  }
}

function makeMockRegistry(host?: ExtendedSessionHost, broadcaster?: PatchesBroadcaster): AgentSessionRegistry {
  const entry = host && broadcaster ? { host, broadcaster } : undefined
  return {
    getHost: vi.fn().mockReturnValue(host),
    getOrCreateHost: vi.fn().mockResolvedValue(entry),
    getBroadcaster: vi.fn().mockReturnValue(broadcaster),
    unregisterHost: vi.fn(),
  }
}

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerRpcRoute(app, registry)
  return app
}

async function postRpc(app: Hono, agentId: string, body: unknown): Promise<Response> {
  return app.request(`/api/agents/${agentId}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agents/:id/rpc", () => {
  describe("404 when connection not found", () => {
    it("returns 404 if registry.getOrCreateHost returns undefined", async () => {
      const registry = makeMockRegistry() // getOrCreateHost returns undefined
      const app = makeApp(registry)

      const res = await postRpc(app, "missing-agent", { method: "cancel", params: { sessionId: "s1" } })
      expect(res.status).toBe(404)
    })
  })

  describe("202 Accepted with version", () => {
    it("returns 202 with {version} for cancel", async () => {
      const state = makeMockState(7)
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "cancel", params: { sessionId: "s1" } })
      expect(res.status).toBe(202)
      const json = await res.json()
      expect(json.version).toBe(7)
    })

    it("returns 202 with {version} for setMode", async () => {
      const state = makeMockState(5)
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "setMode", params: { modeId: "compact" } })
      expect(res.status).toBe(202)
      const json = await res.json()
      expect(json.version).toBe(5)
    })
  })

  describe("method delegation", () => {
    it("prompt: calls host.prompt with sessionId + content", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "sess-42", content: "hello world" },
      })
      expect(host.prompt).toHaveBeenCalledWith("sess-42", "hello world", undefined)
    })

    it("prompt: passes meta if provided", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const meta = { agentId: "a1" }
      await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: "Hi", meta },
      })
      expect(host.prompt).toHaveBeenCalledWith("s1", "Hi", meta)
    })

    it("cancel: calls host.cancel with sessionId", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", { method: "cancel", params: { sessionId: "sess-99" } })
      expect(host.cancel).toHaveBeenCalledWith("sess-99")
    })

    it("setMode: calls host.setMode with modeId", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", { method: "setMode", params: { modeId: "auto" } })
      expect(host.setMode).toHaveBeenCalledWith("auto")
    })

    it("setConfigOption: calls host.setConfigOption with configId + boolean value", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", {
        method: "setConfigOption",
        params: { configId: "verbose", value: true },
      })
      expect(host.setConfigOption).toHaveBeenCalledWith("verbose", true)
    })

    it("setConfigOption: calls host.setConfigOption with string value", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", {
        method: "setConfigOption",
        params: { configId: "model", value: "claude-3-5" },
      })
      expect(host.setConfigOption).toHaveBeenCalledWith("model", "claude-3-5")
    })

    it("extMethod: calls host.extMethod with method + params", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", {
        method: "extMethod",
        params: { method: "_drive/custom", params: { n: 42 } },
      })
      expect(host.extMethod).toHaveBeenCalledWith("_drive/custom", { n: 42 })
    })
  })

  describe("unknown method", () => {
    it("returns 400 for an unknown method name", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "bogus", params: {} })
      expect(res.status).toBe(400)
    })
  })
})
