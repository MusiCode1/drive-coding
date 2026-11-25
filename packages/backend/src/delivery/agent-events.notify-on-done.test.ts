import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { issueToken, resetAllowAlwaysGrantsForTests, SCOPE_HEADER } from "../agent-scope.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import type { AgentOrchestrator, CreateAndSpawnInput } from "../app/agent-orchestrator.js"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import { resetScopePolicyForTests, setScopePolicyOverride } from "../scope-policy.js"
import { checkNotifyOnDoneScope } from "../scope-write.js"
import { createAgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import type { ExtendedSessionHost } from "../session-host/session-host.js"
import { bootAgentEvents } from "./agent-events-boot.js"
import { registerAgentsHttp } from "./http-agents.js"
import { registerMcpHttp } from "./http-mcp.js"

type Transport = "http" | "mcp"

const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
  vi.unstubAllEnvs()
  resetScopePolicyForTests()
  resetAllowAlwaysGrantsForTests()
})

async function fixture({ injectScope = true } = {}) {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const eventBus = createAgentEventBus()
  const env = { CLI_SPECS_FILE: "/nonexistent/drive-coding-test/cli-specs.jsonc" }
  const caller = await registry.create({ cwd: "/test", cliKind: "claude", roleLabel: "Caller" })
  const foreign = await registry.create({
    cwd: "/test",
    cliKind: "claude",
    roleLabel: "Subscriber",
  })
  const sessions = new Map<string, ExtendedSessionHost>()
  const createAndSpawn = vi.fn(async (input: CreateAndSpawnInput) => {
    const created = await registry.create(input)
    sessions.set(created.id, {
      state: { sessionId: `session-${created.id}` },
    } as ExtendedSessionHost)
    return {
      agentId: created.id,
      cliKind: created.cliKind,
      cwd: created.cwd,
      wsUrl: "",
      bridgePort: 0,
      status: "spawning" as const,
    }
  })
  const deleteAndKill = vi.fn(async (id: string) => {
    sessions.delete(id)
    await registry.delete(id)
  })
  const getHost = vi.fn((id: string) => sessions.get(id))
  const getOrCreateHost = vi.fn(async (id: string) => {
    const host = sessions.get(id)
    if (!host) throw new Error("Unexpected host lookup")
    return { ok: true, entry: { host } }
  })
  const orchestrator: AgentOrchestrator = {
    createAndSpawn,
    deleteAndKill,
    deleteAllAndKill: vi.fn(),
    getBridgePort: vi.fn(),
  }
  const agentSessionRegistry = { getHost, getOrCreateHost } as unknown as AgentSessionRegistry
  const deps = { registry, agentSessionRegistry, eventBus }
  const wired = bootAgentEvents(app, { ...deps, orchestrator })
  registerAgentsHttp(app, {
    registry,
    ...(injectScope && {
      checkNotifyOnDone: (token, subscriberAgentId) =>
        checkNotifyOnDoneScope(token, subscriberAgentId, {
          registry,
          sessionRegistry: agentSessionRegistry,
        }),
    }),
    orchestrator: wired.orchestrator,
    sessionHistoryStore: {} as SessionHistoryStore,
    env,
  })
  registerMcpHttp(app, {
    ...deps,
    orchestrator: wired.orchestrator,
    env,
    urlConfig: { port: 4000, host: "127.0.0.1" },
  })

  async function connect(token?: string, identity?: string) {
    const client = new Client({ name: "notify-on-done-contract", version: "1.0.0" })
    const headers = new Headers()
    if (token !== undefined) headers.set(SCOPE_HEADER, token)
    if (identity !== undefined) headers.set(AGENT_ID_HEADER, identity)
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
        fetch: (input, init) => Promise.resolve(app.request(new Request(input, init))),
        requestInit: { headers },
      }),
    )
    clients.push(client)
    return client
  }

  async function open(transport: Transport, opts: { notifyOnDone?: string; token?: string }) {
    const settings = {
      ...(opts.notifyOnDone === undefined ? {} : { notifyOnDone: opts.notifyOnDone }),
      cwd: "/test",
      includeLastAssistantText: true,
    }
    if (transport === "http") {
      const headers = new Headers({ "Content-Type": "application/json" })
      if (opts.token !== undefined) headers.set(SCOPE_HEADER, opts.token)
      const response = await app.request("/api/agents", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...settings, cliKind: "claude" }),
      })
      const body = (await response.json()) as { agentId?: string; error?: string }
      return { ok: response.ok, status: response.status, agentId: body.agentId, error: body.error }
    }

    const client = await connect(opts.token)
    const result = await client.callTool({
      name: "session_open",
      arguments: { ...settings, cli: "claude" },
    })
    const block = Array.isArray(result.content) ? result.content[0] : undefined
    if (block?.type !== "text") throw new Error("Expected a text result from session_open")
    if (result.isError) {
      const error = block.text.startsWith("{")
        ? (JSON.parse(block.text) as { error?: string }).error
        : block.text
      return { ok: false, error }
    }
    return { ok: true, agentId: (JSON.parse(block.text) as { agent: string }).agent }
  }

  async function unsubscribe(transport: Transport, watched: string, subscriber: string) {
    if (transport === "http") {
      const response = await app.request(`/api/agents/${watched}/subscribe`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", [SCOPE_HEADER]: issueToken(subscriber) },
        body: JSON.stringify({ subscriberAgentId: subscriber }),
      })
      expect(response.status).toBe(204)
    } else {
      const client = await connect(issueToken(subscriber), subscriber)
      const result = await client.callTool({
        name: "agent_unsubscribe",
        arguments: { agentId: watched },
      })
      expect(result.isError).not.toBe(true)
    }
  }

  return {
    caller,
    foreign,
    createAndSpawn,
    getOrCreateHost,
    sessions,
    registry,
    eventBus,
    open,
    unsubscribe,
  }
}

describe("notifyOnDone scope before spawn over public transports", () => {
  const transports = ["http", "mcp"] as const

  it("denies HTTP notifyOnDone when the mount has no scope check", async () => {
    const f = await fixture({ injectScope: false })
    const result = await f.open("http", { notifyOnDone: f.caller.id })
    expect(result).toMatchObject({ ok: false, status: 403, error: "scope-denied" })
    expect(f.createAndSpawn).not.toHaveBeenCalled()
    expect(await f.open("http", {})).toMatchObject({ ok: true, status: 201 })
    expect(f.createAndSpawn).toHaveBeenCalledOnce()
  })

  it.each(transports)(
    "denies unauthorized and invalid scoped subscribers before spawn over %s",
    async (transport) => {
      const f = await fixture()
      setScopePolicyOverride({ message: "deny", update: "allow", close: "allow" })

      for (const token of [issueToken(f.caller.id), "synthetic-invalid-token"]) {
        const result = await f.open(transport, { token, notifyOnDone: f.foreign.id })
        expect(result).toMatchObject({ ok: false, error: "scope-denied" })
        if (transport === "http") expect(result).toHaveProperty("status", 403)
        expect(f.createAndSpawn).not.toHaveBeenCalled()
        expect(f.getOrCreateHost).not.toHaveBeenCalled()
        expect(await f.registry.list()).toHaveLength(2)
      }

      // Ordinary creation continues on the existing path, even with an invalid scope token.
      const ordinary = await f.open(transport, { token: "synthetic-invalid-token" })
      expect(ordinary).toMatchObject({ ok: true, agentId: expect.any(String) })
      expect(f.createAndSpawn).toHaveBeenCalledOnce()
      expect(f.createAndSpawn.mock.calls[0]?.[0].notifyOnDone).toBeUndefined()
    },
  )

  it.each(transports)(
    "preserves empty and malformed notifyOnDone parsing over %s",
    async (transport) => {
      const f = await fixture()
      const malformed = await f.open(transport, { notifyOnDone: "bad-uuid" })
      expect(malformed.ok).toBe(false)
      expect(f.createAndSpawn).not.toHaveBeenCalled()
      const empty = await f.open(transport, { notifyOnDone: "", token: "synthetic-invalid-token" })
      if (transport === "http") {
        expect(empty).toMatchObject({ ok: false, status: 400 })
        expect(f.createAndSpawn).not.toHaveBeenCalled()
      } else {
        expect(empty.ok).toBe(true)
        expect(f.createAndSpawn).toHaveBeenCalledOnce()
        expect(f.createAndSpawn.mock.calls[0]?.[0].notifyOnDone).toBeUndefined()
      }
    },
  )

  it.each(transports)(
    "registers an authorized notifyOnDone over %s and removes it over either transport",
    async (transport) => {
      const f = await fixture()
      setScopePolicyOverride({ message: "deny", update: "deny", close: "deny" })
      vi.stubEnv("DC_MASTER_KEY", "synthetic-master")
      for (const [token, subscriber] of [
        [issueToken(f.caller.id), f.caller.id],
        [undefined, f.foreign.id],
        ["synthetic-master", f.foreign.id],
      ] as const) {
        for (const removal of transports) {
          const result = await f.open(transport, { notifyOnDone: subscriber, token })
          expect(result).toMatchObject({ ok: true, agentId: expect.any(String) })
          if (!result.agentId) throw new Error("Expected new agent id")
          expect(f.eventBus.subscribersOf(result.agentId)).toEqual([subscriber])
          expect(f.eventBus.optionsOf(result.agentId, subscriber)).toEqual({
            includeLastAssistantText: true,
          })
          await f.unsubscribe(removal, result.agentId, subscriber)
          expect(f.eventBus.subscribersOf(result.agentId)).toEqual([])
        }
      }
    },
  )

  it.each(transports)(
    "asks before spawn with a subscriber and a future watched agent over %s",
    async (transport) => {
      const f = await fixture()
      setScopePolicyOverride({ message: "ask" })
      const requestScopePermission = vi.fn<ExtendedSessionHost["requestScopePermission"]>(
        async () => {
          expect(f.createAndSpawn).not.toHaveBeenCalled()
          return "allow_always"
        },
      )
      f.sessions.set(f.caller.id, {
        state: { pending: { permission: null } },
        requestScopePermission,
      } as unknown as ExtendedSessionHost)
      const token = issueToken(f.caller.id)
      const result = await f.open(transport, { token, notifyOnDone: f.foreign.id })
      const shortId = f.foreign.id.slice(0, 6)
      expect(requestScopePermission).toHaveBeenCalledExactlyOnceWith({
        callerId: f.caller.id,
        targetId: f.foreign.id,
        verb: "subscribe",
        detail: {
          caller: "Caller",
          target: "Subscriber",
          verb: "subscribe",
          callerShortId: f.caller.id.slice(0, 6),
          targetShortId: shortId,
          watchedAgentPendingCreation: true,
        },
      })
      expect(result).toMatchObject({ ok: true, agentId: expect.any(String) })
      expect(f.eventBus.subscribersOf(result.agentId ?? "")).toEqual([f.foreign.id])
      expect((await f.open(transport, { token, notifyOnDone: f.foreign.id })).ok).toBe(true)
      expect(requestScopePermission).toHaveBeenCalledOnce()
      expect(f.createAndSpawn).toHaveBeenCalledTimes(2)
    },
  )
})
