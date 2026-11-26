import { describe, expect, it, vi } from "vitest"
import { AGENT_ID_HEADER } from "../../agent-identity.js"
import * as agentScope from "../../agent-scope.js"
import { createInMemoryAgentRegistry } from "../../agents/registry.js"
import { SCOPE_HEADER } from "../../scope-write.js"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import { SessionBusyError } from "../session-switch.js"
import { dispatchRpcBody } from "./rpc-dispatch.js"

const caller = { header: () => undefined }

function setup() {
  const host = {
    state: { version: 3, sessionId: "session-id", messages: [] },
    prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn", lastTurnError: null }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    agentCapabilities: { sessionCapabilities: { list: {} } },
    loadSession: vi.fn().mockRejectedValue(new SessionBusyError()),
  }
  const getOrCreateHost = vi.fn<AgentSessionRegistry["getOrCreateHost"]>().mockResolvedValue({
    ok: true,
    entry: { host } as unknown as Extract<HostResult, { ok: true }>["entry"],
  })
  const sessionRegistry = {
    getOrCreateHost,
    getCwd: () => process.cwd(),
    getCliKind: () => undefined,
  } satisfies Partial<AgentSessionRegistry>
  const deps = {
    registry: createInMemoryAgentRegistry(),
    sessionRegistry: sessionRegistry as unknown as AgentSessionRegistry,
  }
  return { deps, getOrCreateHost, host }
}

describe("dispatchRpcBody", () => {
  it("accepts a prompt without waiting for the turn", async () => {
    const { deps, host } = setup()
    const params = { sessionId: "session-id", content: "hello" }
    expect(
      await dispatchRpcBody(deps, "agent", { method: "session/prompt", params }, caller),
    ).toEqual({ status: 202, body: { version: 3 } })
    expect(host.prompt).toHaveBeenCalledWith("session-id", "hello", undefined)
  })

  it("rechecks the live session after caller lookup, before granting a reply or starting a turn", async () => {
    const { deps, host } = setup()
    let releaseLookup = () => {}
    const lookup = new Promise<null>((resolve) => {
      releaseLookup = () => resolve(null)
    })
    const getCaller = vi.spyOn(deps.registry, "get").mockReturnValue(lookup)
    const recordDispatch = vi.spyOn(agentScope, "recordPromptDispatch")
    const identified = {
      header: (name: string) => (name === AGENT_ID_HEADER ? "sender" : undefined),
    }
    const body = {
      method: "session/prompt",
      waitMs: 100,
      params: { sessionId: "session-id", content: "hello", meta: { recordingId: "" } },
    }
    try {
      const response = dispatchRpcBody(deps, "agent", body, identified)
      await vi.waitFor(() => expect(getCaller).toHaveBeenCalledWith("sender"))
      const switchedState = { ...host.state, sessionId: "other-session" }
      host.state = switchedState
      releaseLookup()

      expect(await response).toEqual({
        status: 409,
        body: {
          error: "Prompt session no longer matches the active session",
          code: "prompt_session_mismatch",
        },
      })
      expect(host.state).toBe(switchedState)
      expect(host.prompt).not.toHaveBeenCalled()
      expect(recordDispatch).not.toHaveBeenCalled()

      const params = { ...body.params, sessionId: "other-session" }
      expect(await dispatchRpcBody(deps, "agent", { ...body, params }, identified)).toEqual({
        status: 200,
        body: { version: 3, ok: true, timedOut: false, messagesSince: [], stopReason: "end_turn" },
      })
      expect(host.prompt).toHaveBeenCalledExactlyOnceWith(
        params.sessionId,
        params.content,
        params.meta,
      )
      expect(recordDispatch).toHaveBeenCalledOnce()
    } finally {
      releaseLookup()
      recordDispatch.mockRestore()
    }
  })

  it("returns the blocking list result even with invalid waitMs", async () => {
    const { deps, host } = setup()
    const result = await dispatchRpcBody(
      deps,
      "agent",
      { method: "session/list", waitMs: "bad" },
      caller,
    )
    expect(result).toEqual({
      status: 200,
      body: { sessions: [], sessionCapabilities: { list: {} } },
    })
    expect(host.listSessions).toHaveBeenCalledOnce()
  })

  it.each(["session/list", "listSessions"])(
    "rejects invalid %s before fetching a cold host",
    async (method) => {
      const { deps, getOrCreateHost } = setup()
      getOrCreateHost.mockResolvedValue({ ok: false, reason: "not-found" })
      expect(
        await dispatchRpcBody(deps, "agent", { method, params: { cwd: "relative" } }, caller),
      ).toMatchObject({ status: 400 })
      expect(getOrCreateHost).not.toHaveBeenCalled()
    },
  )

  it("checks delete scope before validation and both before fetching the host", async () => {
    const { deps, getOrCreateHost } = setup()
    const body = { method: "session/delete", params: { sessionId: 42 } }
    const denied = {
      header: (name: string) => (name === SCOPE_HEADER ? "invalid-test-scope" : undefined),
    }
    expect(await dispatchRpcBody(deps, "agent", body, denied)).toMatchObject({ status: 403 })
    expect(await dispatchRpcBody(deps, "agent", body, caller)).toMatchObject({ status: 400 })
    expect(getOrCreateHost).not.toHaveBeenCalled()
  })

  it("maps a busy load to a conflict", async () => {
    const { deps } = setup()
    const params = { sessionId: "session-id" }
    expect(
      await dispatchRpcBody(deps, "agent", { method: "session/load", params }, caller),
    ).toMatchObject({ status: 409, body: { code: "session_busy" } })
  })

  it("reports the original unknown method", async () => {
    const { deps } = setup()
    expect(await dispatchRpcBody(deps, "agent", { method: "unknown" }, caller)).toEqual({
      status: 400,
      body: { error: "Unknown method: unknown" },
    })
  })

  it("rejects an invalid wait before fetching the host", async () => {
    const { deps, getOrCreateHost } = setup()
    expect(
      await dispatchRpcBody(deps, "agent", { method: "session/prompt", waitMs: -1 }, caller),
    ).toEqual({ status: 400, body: { error: "invalid waitMs" } })
    expect(getOrCreateHost).not.toHaveBeenCalled()
  })

  it("rejects denied scope before fetching the host", async () => {
    const { deps, getOrCreateHost } = setup()
    const denied = {
      header: (name: string) => (name === SCOPE_HEADER ? "invalid-test-scope" : undefined),
    }
    expect(
      await dispatchRpcBody(deps, "agent", { method: "session/prompt" }, denied),
    ).toMatchObject({ status: 403 })
    expect(getOrCreateHost).not.toHaveBeenCalled()
  })

  it.each([["not-found", 404]] as const)("maps host failure %s to %i", async (reason, status) => {
    const { deps, getOrCreateHost } = setup()
    getOrCreateHost.mockResolvedValue({ ok: false, reason })
    expect(await dispatchRpcBody(deps, "agent", { method: "session/list" }, caller)).toEqual({
      status,
      body: { error: "Agent connection not found" },
    })
  })

  it("returns the auth methods when host creation requires authentication", async () => {
    const { deps, getOrCreateHost } = setup()
    const authMethods = [{ id: "sign-in", name: "Sign in" }]
    getOrCreateHost.mockRejectedValue(
      Object.assign(new Error("sign in"), {
        kind: "auth_required",
        authMethods,
      }),
    )
    expect(await dispatchRpcBody(deps, "agent", { method: "session/list" }, caller)).toEqual({
      status: 401,
      body: { error: "sign in", kind: "auth_required", authMethods },
    })
  })

  it("propagates other host creation errors", async () => {
    const { deps, getOrCreateHost } = setup()
    const error = new Error("unexpected failure")
    getOrCreateHost.mockRejectedValue(error)
    await expect(dispatchRpcBody(deps, "agent", { method: "session/list" }, caller)).rejects.toBe(
      error,
    )
  })
})
