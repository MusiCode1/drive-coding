import { describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../../agents/registry.js"
import { SCOPE_HEADER } from "../../scope-write.js"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import { SessionBusyError } from "../session-switch.js"
import { dispatchRpcBody } from "./rpc-dispatch.js"

const caller = { header: () => undefined }

function setup() {
  const host = {
    state: { version: 3 },
    prompt: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
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

  it("returns the blocking list result even with invalid waitMs", async () => {
    const { deps } = setup()
    const result = await dispatchRpcBody(
      deps,
      "agent",
      { method: "session/list", waitMs: "bad" },
      caller,
    )
    expect(result).toEqual({ status: 200, body: { sessions: [], sessionCapabilities: null } })
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
