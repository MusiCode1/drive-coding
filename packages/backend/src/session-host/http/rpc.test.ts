/**
 * rpc.test.ts — TDD tests for POST /api/agents/:id/rpc (C3).
 *
 * Testing: tdd (brief §C3; slice remote-session-view C4 extends with setSessionModel)
 *
 * Tests:
 *   - 404 if connection not found
 *   - 202 Accepted with {version} for each supported method
 *   - prompt: calls host.prompt with sessionId + content (+ optional meta)
 *   - cancel: calls host.cancel
 *   - setMode: calls host.setMode
 *   - setConfigOption: calls host.setConfigOption
 *   - extMethod: calls host.extMethod
 *   - setSessionModel: calls host.setSessionModel (slice remote-session-view C4)
 *   - 400 for unknown method
 *
 * ─── slice session-host-pending-surface C3-ד (TDD): non-blocking prompt/cancel ───
 */

import type { SessionState } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import type { PatchesBroadcaster } from "../patches-broadcaster.js"
import type { AgentSessionRegistry } from "../registry.js"
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
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({ result: "ok" }),
    respondPermission: vi.fn(),
    respondElicitation: vi.fn(),
    listSessions: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    agentCapabilities: {},
  }
}

function makeMockBroadcaster(): PatchesBroadcaster {
  return {
    subscribe: vi.fn().mockReturnValue(new ReadableStream()),
    unsubscribe: vi.fn(),
  }
}

function makeMockRegistry(
  host?: ExtendedSessionHost,
  broadcaster?: PatchesBroadcaster,
): AgentSessionRegistry {
  const entry = host && broadcaster ? { host, broadcaster } : undefined
  return {
    getHost: vi.fn().mockReturnValue(host),
    isHeld: vi.fn().mockReturnValue(Boolean(host)),
    getOrCreateHost: vi.fn().mockResolvedValue(entry),
    getBroadcaster: vi.fn().mockReturnValue(broadcaster),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
    getCwd: vi.fn(),
    getEpoch: vi.fn().mockReturnValue(0),
    touchOwner: vi.fn(),
  }
}

function makeApp(registry: AgentSessionRegistry): Hono {
  const app = new Hono()
  registerRpcRoute(app, registry)
  return app
}

/**
 * MockResponse — structural subset of Response actually used by the tests below.
 *
 * calev-heavy L10: `app.request()` (Hono) declares its return type in terms of the
 * ambient global `Response`, which in this package's tsconfig (`types: ["bun"]`)
 * conflicts with DOM lib's `Response` — every `.status`/`.json()` access on the
 * result was a TS2339 error (pre-existing in this same file before this slice;
 * the setSessionModel tests below added 2 more instances of the identical error by
 * following the existing pattern — that's what L10 flagged as "+2 new errors").
 * Fixing the project-wide type conflict is out of scope here (touches global
 * tsconfig, not this slice). This local structural type sidesteps the ambiguous
 * `Response` name entirely for the one function that needs it.
 */
type MockResponse = { status: number; json(): Promise<{ version?: number; error?: string }> }

async function postRpc(app: Hono, agentId: string, body: unknown): Promise<MockResponse> {
  const res = await app.request(`/api/agents/${agentId}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return res as unknown as MockResponse
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agents/:id/rpc", () => {
  describe("404 when connection not found", () => {
    it("returns 404 if registry.getOrCreateHost returns undefined", async () => {
      const registry = makeMockRegistry() // getOrCreateHost returns undefined
      const app = makeApp(registry)

      const res = await postRpc(app, "missing-agent", {
        method: "cancel",
        params: { sessionId: "s1" },
      })
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

      const res = await postRpc(app, "agent-1", {
        method: "setMode",
        params: { modeId: "compact" },
      })
      expect(res.status).toBe(202)
      const json = await res.json()
      expect(json.version).toBe(5)
    })

    it("returns 202 with {version} for setSessionModel", async () => {
      const state = makeMockState(9)
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "setSessionModel",
        params: { model: "claude-opus" },
      })
      expect(res.status).toBe(202)
      const json = await res.json()
      expect(json.version).toBe(9)
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

    it("setSessionModel: calls host.setSessionModel with model", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", {
        method: "setSessionModel",
        params: { model: "claude-opus" },
      })
      expect(host.setSessionModel).toHaveBeenCalledWith("claude-opus")
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

  describe("invalid JSON body", () => {
    it("returns 400 when the body is not valid JSON", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = (await app.request(`/api/agents/agent-1/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not valid json",
      })) as unknown as MockResponse
      expect(res.status).toBe(400)
    })
  })

  // ─── slice session-host-pending-surface C3-ד: non-blocking prompt/cancel ───

  describe("prompt/cancel: non-blocking (202 immediately, ArkType validation, no unhandled rejection)", () => {
    it("prompt: returns 202 before host.prompt resolves (never-resolving mock)", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.prompt as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: "hi" },
      })
      expect(res.status).toBe(202)
    })

    it("prompt: missing sessionId/content → 400 (ArkType), host.prompt never called", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "prompt", params: { sessionId: "s1" } })
      expect(res.status).toBe(400)
      expect(host.prompt).not.toHaveBeenCalled()
    })

    it("host.prompt that rejects produces no unhandled rejection and no 500", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("turn failed"))
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const rejections: unknown[] = []
      const onRejection = (reason: unknown): void => {
        rejections.push(reason)
      }
      process.on("unhandledRejection", onRejection)
      try {
        const res = await postRpc(app, "agent-1", {
          method: "prompt",
          params: { sessionId: "s1", content: "hi" },
        })
        expect(res.status).toBe(202)
        // let the fire-and-forget .catch settle before asserting
        await new Promise((resolve) => setTimeout(resolve, 10))
      } finally {
        process.off("unhandledRejection", onRejection)
      }
      expect(rejections).toHaveLength(0)
    })

    it("cancel: returns 202 before host.cancel resolves (never-resolving mock)", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.cancel as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "cancel", params: { sessionId: "s1" } })
      expect(res.status).toBe(202)
    })

    it("cancel: missing sessionId → 400 (ArkType), host.cancel never called", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "cancel", params: {} })
      expect(res.status).toBe(400)
      expect(host.cancel).not.toHaveBeenCalled()
    })

    it("host.cancel that rejects produces no unhandled rejection and no 500", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.cancel as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("cancel failed"))
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const rejections: unknown[] = []
      const onRejection = (reason: unknown): void => {
        rejections.push(reason)
      }
      process.on("unhandledRejection", onRejection)
      try {
        const res = await postRpc(app, "agent-1", { method: "cancel", params: { sessionId: "s1" } })
        expect(res.status).toBe(202)
        await new Promise((resolve) => setTimeout(resolve, 10))
      } finally {
        process.off("unhandledRejection", onRejection)
      }
      expect(rejections).toHaveLength(0)
    })
  })
  // ─── slice remote-session-mgmt C3: blocking listSessions/loadSession/deleteSession ───

  describe("listSessions (blocking, real result)", () => {
    it("returns 200 with {sessions, sessionCapabilities} — explicit return, not 202", async () => {
      const host = makeMockHost(makeMockState(11))
      ;(host.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessions: [{ sessionId: "s1" }, { sessionId: "s2" }],
      })
      ;(host as unknown as { agentCapabilities: unknown }).agentCapabilities = {
        sessionCapabilities: { delete: {} },
      }
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "listSessions", params: {} })
      expect(res.status).toBe(200)
      const json = (await res.json()) as unknown as {
        sessions: unknown[]
        sessionCapabilities: unknown
      }
      expect(json.sessions).toEqual([{ sessionId: "s1" }, { sessionId: "s2" }])
      expect(json.sessionCapabilities).toEqual({ delete: {} })
      expect(host.listSessions).toHaveBeenCalledTimes(1)
    })

    it("missing sessions in the host result → sessions:[] ; missing capabilities → null", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({})
      ;(host as unknown as { agentCapabilities: unknown }).agentCapabilities = undefined
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "listSessions", params: {} })
      expect(res.status).toBe(200)
      const json = (await res.json()) as unknown as {
        sessions: unknown[]
        sessionCapabilities: unknown
      }
      expect(json.sessions).toEqual([])
      expect(json.sessionCapabilities).toBeNull()
    })

    it("host.listSessions rejecting → 502 with {error, code}", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.listSessions as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("Method not found"), { code: -32601 }),
      )
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "listSessions", params: {} })
      expect(res.status).toBe(502)
      const json = (await res.json()) as unknown as { error: string; code: number }
      expect(json.code).toBe(-32601)
      expect(json.error).toBe("Method not found")
    })
  })

  describe("loadSession (blocking, cwd resolution, notifySessionAttached)", () => {
    it("happy path: 200 {sessionId, version}; cwd from params passed to host; notifySessionAttached called", async () => {
      const host = makeMockHost(makeMockState(13))
      ;(host.loadSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: "sess-9",
        version: 13,
      })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "loadSession",
        params: { sessionId: "sess-9", cwd: "/from/params" },
      })
      expect(res.status).toBe(200)
      const json = (await res.json()) as unknown as { sessionId: string; version: number }
      expect(json.sessionId).toBe("sess-9")
      expect(json.version).toBe(13)
      expect(host.loadSession).toHaveBeenCalledWith({ cwd: "/from/params", sessionId: "sess-9" })
      expect(registry.notifySessionAttached).toHaveBeenCalledWith("agent-1", "sess-9")
    })

    it("cwd missing in params → falls back to registry.getCwd", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.loadSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: "sess-9",
        version: 1,
      })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      ;(registry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue("/fallback-cwd")
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "loadSession",
        params: { sessionId: "sess-9" },
      })
      expect(res.status).toBe(200)
      expect(registry.getCwd).toHaveBeenCalledWith("agent-1")
      expect(host.loadSession).toHaveBeenCalledWith({ cwd: "/fallback-cwd", sessionId: "sess-9" })
    })

    it("cwd missing in params AND registry.getCwd undefined → 400 'no cwd available'", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      ;(registry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "loadSession",
        params: { sessionId: "sess-9" },
      })
      expect(res.status).toBe(400)
      const json = (await res.json()) as unknown as { error: string }
      expect(json.error).toBe("no cwd available")
      expect(host.loadSession).not.toHaveBeenCalled()
    })

    it("missing sessionId in params → 400 (ArkType), host.loadSession never called", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "loadSession", params: { cwd: "/x" } })
      expect(res.status).toBe(400)
      expect(host.loadSession).not.toHaveBeenCalled()
    })

    it("host.loadSession rejecting → 502 with {error, code}; notifySessionAttached NOT called", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.loadSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("load failed"), { code: -32000 }),
      )
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "loadSession",
        params: { sessionId: "s", cwd: "/x" },
      })
      expect(res.status).toBe(502)
      const json = (await res.json()) as unknown as { error: string; code: number }
      expect(json.code).toBe(-32000)
      expect(registry.notifySessionAttached).not.toHaveBeenCalled()
    })

    it("notifySessionAttached rejecting does NOT fail the switch (catch+warn) → still 200", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.loadSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: "sess-9",
        version: 1,
      })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      ;(registry.notifySessionAttached as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("registry down"),
      )
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "loadSession",
        params: { sessionId: "sess-9", cwd: "/x" },
      })
      expect(res.status).toBe(200)
    })
  })

  describe("deleteSession (blocking, -32601 graceful)", () => {
    it("happy path: 200 {ok:true}; passes sessionId to host", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "deleteSession",
        params: { sessionId: "sess-del" },
      })
      expect(res.status).toBe(200)
      const json = (await res.json()) as unknown as { ok: boolean }
      expect(json.ok).toBe(true)
      expect(host.deleteSession).toHaveBeenCalledWith("sess-del")
    })

    it("-32601 (unsupported) → 200 {ok:false, unsupported:true}, NOT 500", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.deleteSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("Method not found"), { code: -32601 }),
      )
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "deleteSession",
        params: { sessionId: "sess-del" },
      })
      expect(res.status).toBe(200)
      const json = (await res.json()) as unknown as { ok: boolean; unsupported: boolean }
      expect(json.ok).toBe(false)
      expect(json.unsupported).toBe(true)
    })

    it("non-32601 error → 502 with {error, code}", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.deleteSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("disk full"), { code: -32000 }),
      )
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "deleteSession",
        params: { sessionId: "sess-del" },
      })
      expect(res.status).toBe(502)
      const json = (await res.json()) as unknown as { error: string; code: number }
      expect(json.code).toBe(-32000)
    })

    it("missing sessionId → 400 (ArkType), host.deleteSession never called", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "deleteSession", params: {} })
      expect(res.status).toBe(400)
      expect(host.deleteSession).not.toHaveBeenCalled()
    })
  })

  describe("202 stays only for the six original methods", () => {
    it.each([
      ["prompt", { sessionId: "s1", content: "hi" }],
      ["cancel", { sessionId: "s1" }],
      ["setMode", { modeId: "auto" }],
      ["setConfigOption", { configId: "k", value: true }],
      ["extMethod", { method: "_drive/x", params: {} }],
      ["setSessionModel", { model: "m" }],
    ])("%s still returns 202", async (method, params) => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method, params })
      expect(res.status).toBe(202)
    })
  })
})
