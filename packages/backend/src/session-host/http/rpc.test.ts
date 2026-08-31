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
import {
  applyUserMessage,
  createInitialSessionState,
  synthesizeUserMessage,
} from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks, PromptBlocks } from "@drive-coding/provider/client"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildAgentMcpServers } from "../../agent-identity.js"
import { setSelfBaseUrlForTests } from "../../instances.js"
import type { PatchesBroadcaster } from "../patches-broadcaster.js"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { createSessionHost } from "../session-host.js"
import { registerRpcRoute } from "./rpc.js"

// ── mock helpers ──────────────────────────────────────────────────────────────

function makeMockState(version = 3): SessionState {
  return { ...createInitialSessionState({ sessionId: null }), version }
}

function makeMockHost(state: SessionState): ExtendedSessionHost {
  return {
    state,
    patches: new ReadableStream({ start() {} }),
    prompt: vi.fn().mockImplementation(async (_sessionId, content, meta) => {
      const msg = synthesizeUserMessage(state, content as string | PromptBlocks, meta)
      const applied = applyUserMessage(state, msg)
      Object.assign(state, applied.state)
    }),
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
    agentCapabilities: { mcpCapabilities: { http: true } },
  }
}

function makeMockBroadcaster(): PatchesBroadcaster {
  return {
    subscribe: vi.fn().mockReturnValue(new ReadableStream()),
    unsubscribe: vi.fn(),
    close: vi.fn(),
  }
}

function makeMockRegistry(
  host?: ExtendedSessionHost,
  broadcaster?: PatchesBroadcaster,
): AgentSessionRegistry {
  // slice host-result-reason C1: getOrCreateHost now resolves a discriminated
  // HostResult, not HostEntry | undefined — vi.fn() is untyped (`any`), so
  // getting this shape wrong would pass typecheck silently and fail at runtime
  // (result.ok undefined ⇒ treated as failure even on the success path).
  const result: HostResult =
    host && broadcaster
      ? { ok: true, entry: { host, broadcaster } }
      : { ok: false, reason: "not-found" }
  return {
    getHost: vi.fn().mockReturnValue(host),
    isHeld: vi.fn().mockReturnValue(Boolean(host)),
    getOrCreateHost: vi.fn().mockResolvedValue(result),
    getBroadcaster: vi.fn().mockReturnValue(broadcaster),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn().mockResolvedValue(undefined),
    getCwd: vi.fn(),
    getCliKind: vi.fn(),
    getEpoch: vi.fn().mockReturnValue(0),
    touchConnection: vi.fn(),
    getRuntimeInfo: vi.fn().mockReturnValue(null),
    getConnectionCount: vi.fn().mockReturnValue(0),
    stop: vi.fn(),
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
type MockResponse = {
  status: number
  json(): Promise<{
    version?: number
    error?: string
    ok?: boolean
    timedOut?: boolean
    messagesSince?: unknown[]
    result?: unknown
    code?: number
  }>
}

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
    it("returns 404 if registry.getOrCreateHost resolves {ok:false, reason:'not-found'}", async () => {
      const registry = makeMockRegistry() // getOrCreateHost → {ok:false, reason:"not-found"}
      const app = makeApp(registry)

      const res = await postRpc(app, "missing-agent", {
        method: "cancel",
        params: { sessionId: "s1" },
      })
      expect(res.status).toBe(404)
    })
  })

  // ─── slice host-result-reason C1: evict-timeout is TRANSIENT → 503, not 404 ───
  describe("503 when eviction of a stuck WS owner times out", () => {
    it("returns 503 (not 404) when getOrCreateHost resolves {ok:false, reason:'evict-timeout'}", async () => {
      const registry = makeMockRegistry()
      ;(registry.getOrCreateHost as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        reason: "evict-timeout",
      })
      const app = makeApp(registry)

      const res = await postRpc(app, "stuck-agent", {
        method: "cancel",
        params: { sessionId: "s1" },
      })
      expect(res.status).toBe(503)
    })

    // slice host-result-reason C1 §6 DoD 4 — mutation check: reverting the
    // `result.reason === "evict-timeout" ? 503 : 404` mapping to a flat `404`
    // turns this assertion red (documented, not committed).
    it("still returns 404 for the three FINAL reasons (not-found/conn-dead/ws-owned) — unchanged", async () => {
      const registry = makeMockRegistry()
      for (const reason of ["not-found", "conn-dead", "ws-owned"] as const) {
        ;(registry.getOrCreateHost as ReturnType<typeof vi.fn>).mockResolvedValue({
          ok: false,
          reason,
        })
        const app = makeApp(registry)
        const res = await postRpc(app, "some-agent", {
          method: "cancel",
          params: { sessionId: "s1" },
        })
        expect(res.status).toBe(404)
      }
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

    // ─── slice remote-images C1 (TDD) ───
    it("prompt: content as PromptBlocks array → 202, host.prompt called with blocks", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)
      const blocks = [
        { type: "image", mimeType: "image/png", data: "abc" },
        { type: "text", text: "describe" },
      ]

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: blocks },
      })
      expect(res.status).toBe(202)
      expect(host.prompt).toHaveBeenCalledWith("s1", blocks, undefined)
    })

    it("prompt: invalid block (type='video') → 400, host.prompt never called", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: [{ type: "video", data: "x" }] },
      })
      expect(res.status).toBe(400)
      expect(host.prompt).not.toHaveBeenCalled()
    })

    it("prompt: image block missing 'data' → 400, host.prompt never called", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: [{ type: "image", mimeType: "image/png" }] },
      })
      expect(res.status).toBe(400)
      expect(host.prompt).not.toHaveBeenCalled()
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

    it("host.listSessions -32601 → 200 {sessions:[], sessionCapabilities} (CF-safe)", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.listSessions as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("Method not found"), { code: -32601 }),
      )
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

    it("host.listSessions rejecting non-32601 → 502 with {error, code}", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.listSessions as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("boom"), { code: -32000 }),
      )
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "listSessions", params: {} })
      expect(res.status).toBe(502)
      const json = (await res.json()) as unknown as { error: string; code: number }
      expect(json.code).toBe(-32000)
      expect(json.error).toBe("boom")
    })
  })

  describe("loadSession (blocking, cwd resolution, notifySessionAttached)", () => {
    const TEST_SELF_BASE = "http://127.0.0.1:4055"
    const expectedMcp = () => buildAgentMcpServers("agent-1", TEST_SELF_BASE)

    beforeEach(() => {
      setSelfBaseUrlForTests(TEST_SELF_BASE)
    })
    afterEach(() => {
      setSelfBaseUrlForTests(undefined)
    })

    it("happy path: 200 {sessionId, version}; cwd from params passed to host and to notifySessionAttached", async () => {
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
      expect(host.loadSession).toHaveBeenCalledWith({
        cwd: "/from/params",
        sessionId: "sess-9",
        mcpServers: expectedMcp(),
      })
      // slice agent-patch-unify C2: ה-cwd שכבר חושב כאן (מ-params או מ-fallback)
      // עובר גם ל-notifySessionAttached — זו החוליה שהייתה חסרה בשרשרת ה-cwd (§3).
      expect(registry.notifySessionAttached).toHaveBeenCalledWith(
        "agent-1",
        "sess-9",
        "/from/params",
      )
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
      expect(host.loadSession).toHaveBeenCalledWith({
        cwd: "/fallback-cwd",
        sessionId: "sess-9",
        mcpServers: expectedMcp(),
      })
      // ה-cwd שנפתר (fallback, לא params) הוא זה שמגיע ל-notifySessionAttached.
      expect(registry.notifySessionAttached).toHaveBeenCalledWith(
        "agent-1",
        "sess-9",
        "/fallback-cwd",
      )
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

    it("omits mcpServers when agent did not declare http MCP in initialize", async () => {
      const host = makeMockHost(makeMockState())
      ;(host as ExtendedSessionHost).agentCapabilities = {}
      ;(host.loadSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: "sess-9",
        version: 1,
      })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "loadSession",
        params: { sessionId: "sess-9", cwd: "/from/params" },
      })
      expect(res.status).toBe(200)
      expect(host.loadSession).toHaveBeenCalledWith({ cwd: "/from/params", sessionId: "sess-9" })
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

  describe("newSession (blocking, cwd resolution, notifySessionAttached, Claude _meta)", () => {
    const TEST_SELF_BASE = "http://127.0.0.1:4055"
    const expectedMcp = () => buildAgentMcpServers("agent-1", TEST_SELF_BASE)

    beforeEach(() => {
      setSelfBaseUrlForTests(TEST_SELF_BASE)
    })
    afterEach(() => {
      setSelfBaseUrlForTests(undefined)
    })

    it("happy path: 200 {sessionId, version}; cwd from params; notifySessionAttached", async () => {
      const host = makeMockHost(makeMockState(7))
      ;(host.newSession as ReturnType<typeof vi.fn>).mockResolvedValue({ sessionId: "sess-new" })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "newSession",
        params: { cwd: "/from/params" },
      })
      expect(res.status).toBe(200)
      const json = (await res.json()) as unknown as { sessionId: string; version: number }
      expect(json.sessionId).toBe("sess-new")
      expect(json.version).toBe(7)
      expect(host.newSession).toHaveBeenCalledWith({
        cwd: "/from/params",
        mcpServers: expectedMcp(),
      })
      expect(registry.notifySessionAttached).toHaveBeenCalledWith(
        "agent-1",
        "sess-new",
        "/from/params",
      )
    })

    it("cwd missing → falls back to registry.getCwd", async () => {
      const host = makeMockHost(makeMockState(1))
      ;(host.newSession as ReturnType<typeof vi.fn>).mockResolvedValue({ sessionId: "sess-fb" })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      ;(registry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue("/fallback-cwd")
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "newSession", params: {} })
      expect(res.status).toBe(200)
      expect(host.newSession).toHaveBeenCalledWith({
        cwd: "/fallback-cwd",
        mcpServers: expectedMcp(),
      })
    })

    it("no cwd available → 400; host.newSession never called", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      ;(registry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "newSession", params: {} })
      expect(res.status).toBe(400)
      expect(host.newSession).not.toHaveBeenCalled()
    })

    it("cliKind claude → injects _meta; other cliKinds omit it", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.newSession as ReturnType<typeof vi.fn>).mockResolvedValue({ sessionId: "s" })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      ;(registry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue("/c")
      ;(registry.getCliKind as ReturnType<typeof vi.fn>).mockReturnValue("claude")
      const app = makeApp(registry)

      await postRpc(app, "agent-1", { method: "newSession", params: {} })
      expect(host.newSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/c",
          _meta: expect.objectContaining({ claudeCode: expect.any(Object) }),
        }),
      )

      ;(host.newSession as ReturnType<typeof vi.fn>).mockClear()
      ;(registry.getCliKind as ReturnType<typeof vi.fn>).mockReturnValue("cursor")
      await postRpc(app, "agent-1", { method: "newSession", params: {} })
      const call = (host.newSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
        string,
        unknown
      >
      expect(call._meta).toBeUndefined()
    })

    it("host.newSession rejecting → 502; notifySessionAttached NOT called", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.newSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error("cli boom"), { code: -32000 }),
      )
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      ;(registry.getCwd as ReturnType<typeof vi.fn>).mockReturnValue("/c")
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "newSession", params: {} })
      expect(res.status).toBe(502)
      expect(registry.notifySessionAttached).not.toHaveBeenCalled()
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

  // ─── slice rpc-wait C1: prompt + waitMs ───

  describe("prompt waitMs (slice rpc-wait C1)", () => {
    it("without waitMs → 202 regression (byte-for-byte contract)", async () => {
      const state = makeMockState(7)
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: "hi" },
      })
      expect(res.status).toBe(202)
      // prompt adds user message synchronously before first await — version bumps
      expect(await res.json()).toEqual({ version: 8 })
    })

    it.each([
      [-1],
      [60_001],
      [1.5],
      ["5000"],
    ])("invalid waitMs %j → 400 (status only)", async (waitMs) => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: "hi" },
        waitMs,
      })
      expect(res.status).toBe(400)
    })

    it("waitMs success → 200 {ok:true, timedOut:false, messagesSince}", async () => {
      const state = makeMockState(10)
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: "hello wait" },
        waitMs: 5000,
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toMatchObject({ ok: true, timedOut: false, version: 11 })
      expect(json.messagesSince).toHaveLength(1)
      expect(json.messagesSince?.[0]).toMatchObject({ role: "user" })
    })

    it("waitMs turn failure → 200 {ok:false, error from rejection, messagesSince}", async () => {
      const state = makeMockState(11)
      const host = makeMockHost(state)
      ;(host.prompt as ReturnType<typeof vi.fn>).mockImplementation(async (_sid, content, meta) => {
        const msg = synthesizeUserMessage(state, content as string | PromptBlocks, meta)
        Object.assign(state, applyUserMessage(state, msg).state)
        throw Object.assign(new Error("turn failed"), { code: -32601 })
      })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: "fail me" },
        waitMs: 5000,
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toMatchObject({
        ok: false,
        timedOut: false,
        error: { message: "turn failed", code: -32601 },
      })
      expect(json.messagesSince).toHaveLength(1)
    })

    it("waitMs timeout → 200 {ok:false, timedOut:true}, no messagesSince key", async () => {
      const state = makeMockState(12)
      const host = makeMockHost(state)
      ;(host.prompt as ReturnType<typeof vi.fn>).mockImplementation(async (_sid, content, meta) => {
        const msg = synthesizeUserMessage(state, content as string | PromptBlocks, meta)
        Object.assign(state, applyUserMessage(state, msg).state)
        await new Promise(() => {})
      })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "s1", content: "slow" },
        waitMs: 30,
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toEqual({ version: 13, ok: false, timedOut: true })
      expect(json.messagesSince).toBeUndefined()
    })

    it("late prompt rejection after timeout → no unhandledRejection", async () => {
      const state = makeMockState()
      const host = makeMockHost(state)
      ;(host.prompt as ReturnType<typeof vi.fn>).mockImplementation(async (_sid, content, meta) => {
        const msg = synthesizeUserMessage(state, content as string | PromptBlocks, meta)
        Object.assign(state, applyUserMessage(state, msg).state)
        await new Promise((resolve) => setTimeout(resolve, 50))
        throw new Error("late turn failed")
      })
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
          params: { sessionId: "s1", content: "late" },
          waitMs: 20,
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ timedOut: true })
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(rejections).toHaveLength(0)
      } finally {
        process.off("unhandledRejection", onRejection)
      }
    })
  })

  describe("prompt waitMs integration (real SessionHost)", () => {
    it("messagesSince from real host.prompt synthesizeUserMessage path", async () => {
      const host = await createSessionHost({
        createClient: async (_callbacks: AcpClientCallbacks) => {
          const mock = {
            newSession: vi.fn().mockResolvedValue({ sessionId: "test-session-id" }),
            loadSession: vi.fn().mockResolvedValue({ sessionId: "test-session-id" }),
            prompt: vi
              .fn()
              .mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 15))),
            cancel: vi.fn().mockResolvedValue(undefined),
            conn: { sessionUpdate: vi.fn() },
          }
          return mock as unknown as AcpClient
        },
      })

      const registry = makeMockRegistry(
        host as unknown as ExtendedSessionHost,
        makeMockBroadcaster(),
      )
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "prompt",
        params: { sessionId: "test-session-id", content: "integration hello" },
        waitMs: 500,
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.messagesSince).toHaveLength(1)
      const first = json.messagesSince?.[0] as { role: string; segments: { text: string }[] }
      expect(first.role).toBe("user")
      expect(first.segments[0]?.text).toBe("integration hello")
    })
  })

  // ─── slice rpc-wait C2: five remaining methods + extMethod result ───

  describe("waitMs on cancel/setMode/setConfigOption/extMethod/setSessionModel (C2)", () => {
    it.each([
      ["cancel", { sessionId: "s1" }],
      ["setMode", { modeId: "auto" }],
      ["setConfigOption", { configId: "k", value: true }],
      ["setSessionModel", { model: "claude-opus" }],
    ] as const)("without waitMs %s → 202 regression", async (method, params) => {
      const state = makeMockState(4)
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method, params })
      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ version: 4 })
    })

    it.each([
      ["cancel", { sessionId: "s1" }],
      ["setMode", { modeId: "auto" }],
      ["setConfigOption", { configId: "k", value: true }],
      ["setSessionModel", { model: "claude-opus" }],
    ] as const)("with waitMs %s → 200 {ok:true, timedOut:false}", async (method, params) => {
      const host = makeMockHost(makeMockState(6))
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method, params, waitMs: 5000 })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, timedOut: false })
    })

    it("extMethod without waitMs → 202 regression", async () => {
      const state = makeMockState(4)
      const host = makeMockHost(state)
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "extMethod",
        params: { method: "_drive/custom", params: { n: 1 } },
      })
      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ version: 4 })
    })

    it("extMethod with waitMs → 200 {ok:true, result}", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.extMethod as ReturnType<typeof vi.fn>).mockResolvedValue({ answer: 42 })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "extMethod",
        params: { method: "_drive/custom", params: {} },
        waitMs: 5000,
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toMatchObject({ ok: true, timedOut: false, result: { answer: 42 } })
    })

    it("listSessions with invalid waitMs → 200 (ignored silently)", async () => {
      const host = makeMockHost(makeMockState())
      ;(host.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [] })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "listSessions",
        params: {},
        waitMs: -1,
      })
      expect(res.status).toBe(200)
    })
  })

  // ─── slice acp-method-names ─────────────────────────────────────────────
  //
  // ⚠️ שים לב לכל שאר הקובץ: **הוא לא השתנה.** כל 44 הטסטים שמעל שולחים את
  // השמות הישנים ועוברים כמות שהם — וזו בדיוק ההוכחה שחלון-המעבר חי, ולא
  // טענה שצריך להאמין לה. הטסטים כאן מוסיפים את החצי השני.
  describe("canonical ACP method names", () => {
    it.each([
      ["session/prompt", { sessionId: "s1", content: "hi" }],
      ["session/cancel", { sessionId: "s1" }],
      ["session/set_mode", { modeId: "auto" }],
      ["session/set_config_option", { configId: "k", value: true }],
      ["_drive/ext", { method: "_drive/x", params: {} }],
      ["_drive/set_session_model", { model: "m" }],
    ])("%s dispatches and returns 202", async (method, params) => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method, params })
      expect(res.status).toBe(202)
    })

    it("session/prompt reaches host.prompt with the same arguments as the legacy name", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      await postRpc(app, "agent-1", {
        method: "session/prompt",
        params: { sessionId: "s1", content: "hi" },
      })
      expect(host.prompt).toHaveBeenCalledWith("s1", "hi", undefined)
    })

    it("session/list returns the blocking 200 body, not a 202 ack", async () => {
      const host = makeMockHost(makeMockState())
      host.listSessions = vi.fn().mockResolvedValue({ sessions: [{ sessionId: "a" }] })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "session/list", params: {} })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ sessions: [{ sessionId: "a" }] })
    })

    it("session/delete maps -32601 to the graceful unsupported body", async () => {
      const host = makeMockHost(makeMockState())
      host.deleteSession = vi.fn().mockRejectedValue({ code: -32601, message: "nope" })
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", {
        method: "session/delete",
        params: { sessionId: "s1" },
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: false, unsupported: true })
    })

    // 🔴 הכשל שהתיקון הזה נועד למנוע: השם המנורמל הוא `undefined` בדיוק
    // כאן, ולכן דיווח שלו במקום השם שנשלח היה מוחק את הפרט היחיד שמאפשר
    // לאבחן — "Unknown method: undefined".
    it("an unknown method reports the name the caller actually sent", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      const res = await postRpc(app, "agent-1", { method: "session/teleport", params: {} })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "Unknown method: session/teleport" })
    })

    // ⚠️ קלט חיצוני מגיע ישירות לטבלת-ההקבלה. מפתח ירושתי אינו שם-מתודה.
    it("an inherited Object key is not a method", async () => {
      const host = makeMockHost(makeMockState())
      const registry = makeMockRegistry(host, makeMockBroadcaster())
      const app = makeApp(registry)

      for (const method of ["toString", "constructor", "__proto__"]) {
        const res = await postRpc(app, "agent-1", { method, params: {} })
        expect(res.status).toBe(400)
      }
    })
  })
})
