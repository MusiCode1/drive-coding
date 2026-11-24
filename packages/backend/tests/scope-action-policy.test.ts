/**
 * scope-action-policy.test.ts — C1 integration: policy matrix + shared gates.
 */

import { RPC_METHODS } from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createConnectionRegistry } from "../src/acp/connection-registry.js"
import { AGENT_ID_HEADER } from "../src/agent-identity.js"
import * as scope from "../src/agent-scope.js"
import {
  authorizeWrite,
  issueToken,
  recordAllowAlwaysGrant,
  resetAllowAlwaysGrantsForTests,
  resetScopeSecretForTests,
  SCOPE_HEADER,
  setScopeEnforcementForTests,
} from "../src/agent-scope.js"
import * as launcher from "../src/agents/agent-launcher.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { type AgentOrchestrator, createAgentOrchestrator } from "../src/app/agent-orchestrator.js"
import { bindScopeEnforcement } from "../src/bind-scope-enforcement.js"
import { registerAgentsHttp } from "../src/delivery/http-agents.js"
import { registerMcpHttp } from "../src/delivery/http-mcp.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { resetScopePolicyForTests, setScopePolicyOverride } from "../src/scope-policy.js"
import { SCOPE_DENIED_BODY } from "../src/scope-write.js"
import { createAgentEventBus } from "../src/session-host/agent-events.js"
import { registerSessionHostHttp } from "../src/session-host/http/index.js"
import { setSelfApproveGuardForTests } from "../src/session-host/http/reply.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"

function makeMockConn(agentId: string): ProviderConnection {
  return {
    agentId,
    cliKind: "cursor",
    wire: { send: vi.fn(), onLine: () => () => {} },
    onCrash: () => () => {},
    close: vi.fn(),
    pid: null,
  } as unknown as ProviderConnection
}

async function makePolicyApp() {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const deleted: string[] = []
  const connectionRegistry = {
    get: vi.fn((id: string) => makeMockConn(id)),
    getCwd: vi.fn(() => "/tmp/scope-policy"),
    getCharter: vi.fn(() => undefined),
    consumeCharter: vi.fn(() => undefined),
    getCliKind: vi.fn(() => "cursor"),
    getOwner: vi.fn(() => ({ via: "http" as const })),
    getLastSeenAt: vi.fn(() => Date.now()),
    getEpoch: vi.fn(() => 0),
    getRuntimeInfo: vi.fn(() => ({
      pid: null,
      attached: true,
      busy: false,
      lastMessageAt: null,
      lastSeenAt: Date.now(),
      via: "http" as const,
    })),
    getConnectionCount: vi.fn(() => 0),
    markOwned: vi.fn(),
    markDetached: vi.fn(),
    touchOwner: vi.fn(),
  }

  const agentSessionRegistry = createAgentSessionRegistry({
    connectionRegistry: connectionRegistry as never,
    _createHostFn: async (conn, opts) =>
      createSessionHostFromConnection(conn, {
        ...opts,
        _createAcpClient: async (_transport: AcpTransport, _callbacks: AcpClientCallbacks) => {
          const client: AcpClient = {
            newSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
            loadSession: vi.fn().mockResolvedValue({ sessionId: "s1" }),
            prompt: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn().mockResolvedValue(undefined),
            setSessionMode: vi.fn().mockResolvedValue(undefined),
            setSessionConfigOption: vi.fn().mockResolvedValue({ configOptions: [] }),
            setSessionModel: vi.fn().mockResolvedValue(undefined),
            extMethod: vi.fn().mockResolvedValue({}),
            listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
            deleteSession: vi.fn().mockResolvedValue(undefined),
            capabilities: { mcpCapabilities: { http: true } },
          }
          return client
        },
      }),
  })

  const orchestrator: AgentOrchestrator = {
    async createAndSpawn(input) {
      const agent = await registry.create(input)
      return {
        agentId: agent.id,
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        wsUrl: "",
        bridgePort: 0,
        status: "spawning",
      }
    },
    async deleteAndKill(id) {
      deleted.push(id)
      await registry.delete(id)
    },
    getBridgePort: () => 0,
  }

  bindScopeEnforcement(app, { registry, sessionRegistry: agentSessionRegistry })
  registerAgentsHttp(app, {
    registry,
    orchestrator,
    bridgeManager: connectionRegistry as never,
  })
  registerSessionHostHttp(app, {
    agentSessionRegistry,
    connectionRegistry: connectionRegistry as never,
    agentRegistry: registry,
  })
  registerMcpHttp(app, {
    registry,
    orchestrator,
    agentSessionRegistry,
    env: process.env,
    urlConfig: { port: 4056, host: "127.0.0.1" },
    selfBaseUrl: "http://127.0.0.1:4056",
    eventBus: createAgentEventBus(),
  })
  setSelfBaseUrlForTests("http://127.0.0.1:4056")

  return { app, registry, agentSessionRegistry, deleted, connectionRegistry }
}

function honoFetch(app: Hono): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    return app.request(req)
  }) as typeof fetch
}

async function connectMcp(app: Hono, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "scope-policy-test", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:4056/api/mcp"), {
    fetch: honoFetch(app),
    requestInit: { headers },
  })
  await client.connect(transport)
  return client
}

describe("scope action policy C1", () => {
  afterEach(() => {
    setScopeEnforcementForTests(true)
    setSelfApproveGuardForTests(true)
    resetAllowAlwaysGrantsForTests()
    resetScopeSecretForTests()
    resetScopePolicyForTests()
    setSelfBaseUrlForTests(undefined)
    vi.restoreAllMocks()
  })

  it("default ask creates pending on stranger close", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)
    expect(hostA).toBeDefined()
    if (!hostA) return

    const delPromise = app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })

    await vi.waitFor(() => {
      expect(hostA.state.pending.permission).not.toBeNull()
    })
    void delPromise
  })

  it("allow close succeeds without caller host or client", async () => {
    const { app, registry, deleted } = await makePolicyApp()
    setScopePolicyOverride({ close: "allow" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const del = await app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    expect(del.status).toBe(204)
    expect(deleted).toContain(b.id)
  })

  it("deny close returns scope-denied without pending", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ close: "deny" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)
    expect(hostA).toBeDefined()
    if (!hostA) return

    const del = await app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    expect(del.status).toBe(403)
    expect(await del.json()).toEqual(SCOPE_DENIED_BODY)
    expect(hostA.state.pending.permission).toBeNull()
  })

  it("forged token stays deny before policy", async () => {
    const { app, registry } = await makePolicyApp()
    setScopePolicyOverride({ close: "allow" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const del = await app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: "not-a-token", [AGENT_ID_HEADER]: "fake" },
    })
    expect(del.status).toBe(403)
  })

  it("message allow with close ask still prompts on close", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "allow", close: "ask" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)
    expect(hostA).toBeDefined()
    if (!hostA) return

    const delPromise = app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    await vi.waitFor(() => {
      expect(hostA.state.pending.permission).not.toBeNull()
    })
    void delPromise
  })

  it("message allow with close deny rejects close", async () => {
    const { app, registry, deleted } = await makePolicyApp()
    setScopePolicyOverride({ message: "allow", close: "deny" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const del = await app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    expect(del.status).toBe(403)
    expect(deleted).not.toContain(b.id)
  })

  it("RPC and HTTP share deny policy", async () => {
    const { app, registry } = await makePolicyApp()
    setScopePolicyOverride({ update: "deny" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    const headers = {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
      "Content-Type": "application/json",
    }

    const patch = await app.request(`/api/agents/${b.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ label: "x" }),
    })
    expect(patch.status).toBe(403)

    const rpc = await app.request(`/api/agents/${b.id}/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        method: RPC_METHODS.setConfigOption,
        params: { configId: "model", value: "x" },
      }),
    })
    expect(rpc.status).toBe(403)
  })

  it.each([
    { message: "allow" as const, status: 202 },
    { message: "deny" as const, status: 403 },
  ])("cancel follows the message policy ($message)", async ({ message, status }) => {
    const { app, registry } = await makePolicyApp()
    setScopePolicyOverride({ message, update: "deny" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const response = await app.request(`/api/agents/${b.id}/rpc`, {
      method: "POST",
      headers: { [SCOPE_HEADER]: issueToken(a.id), "Content-Type": "application/json" },
      body: JSON.stringify({ method: RPC_METHODS.cancel, params: { sessionId: "s1" } }),
    })
    expect(response.status).toBe(status)
    if (status === 403) expect(await response.json()).toEqual(SCOPE_DENIED_BODY)
  })

  it("shares only messaging grants across send, prompt and cancel", async () => {
    const token = issueToken("caller")
    const allowed = (verb: string, targetId = "target") =>
      authorizeWrite({
        token,
        verb,
        targetId,
        agents: [],
        onEscalate: async () => "deny",
      })

    recordAllowAlwaysGrant("caller", "target", "send")
    expect(await allowed(RPC_METHODS.prompt)).toBe("allow")
    expect(await allowed(RPC_METHODS.cancel)).toBe("allow")
    expect(await allowed("subscribe")).toBe("deny")
    expect(await allowed("send", "other")).toBe("deny")

    recordAllowAlwaysGrant("caller", "other", "subscribe")
    expect(await allowed("send", "other")).toBe("deny")
    recordAllowAlwaysGrant("caller", "target", "patch")
    expect(await allowed("patch")).toBe("allow")
    expect(await allowed("reply")).toBe("deny")
    expect(await allowed("detach")).toBe("deny")
  })

  it("ext RPC stays ask when all selectors allow", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "allow", update: "allow", close: "allow" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)
    expect(hostA).toBeDefined()
    if (!hostA) return

    const rpcPromise = app.request(`/api/agents/${b.id}/rpc`, {
      method: "POST",
      headers: {
        [SCOPE_HEADER]: tokenA,
        [AGENT_ID_HEADER]: a.id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: RPC_METHODS.extMethod,
        params: { method: "noop", params: {} },
      }),
    })

    await vi.waitFor(() => {
      expect(hostA.state.pending.permission).not.toBeNull()
    })
    void rpcPromise
  })

  it("mixed MCP send+sets skips side effects when message deny and update allow", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "deny", update: "allow" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const hostResult = await agentSessionRegistry.getOrCreateHost(b.id)
    expect(hostResult.ok).toBe(true)
    const hostB = hostResult.entry.host
    hostB.state.sessionId = "s1"
    const setSpy = vi.spyOn(hostB, "setConfigOption")
    const promptSpy = vi.spyOn(hostB, "prompt")

    const client = await connectMcp(app, {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
    })
    const result = await client.callTool({
      name: "session_send",
      arguments: {
        agent: b.id,
        prompt: "hi",
        sets: { model: "fast" },
        noWait: true,
      },
    })
    expect(result.isError).toBe(true)
    expect(setSpy).not.toHaveBeenCalled()
    expect(promptSpy).not.toHaveBeenCalled()
    await client.close()
  })

  it("mixed MCP send+sets skips side effects when update deny", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "allow", update: "deny" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const hostResult = await agentSessionRegistry.getOrCreateHost(b.id)
    expect(hostResult.ok).toBe(true)
    const hostB = hostResult.entry.host
    hostB.state.sessionId = "s1"
    const setSpy = vi.spyOn(hostB, "setConfigOption")
    const promptSpy = vi.spyOn(hostB, "prompt")

    const client = await connectMcp(app, {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
    })
    const result = await client.callTool({
      name: "session_send",
      arguments: {
        agent: b.id,
        prompt: "hi",
        sets: { model: "fast" },
        noWait: true,
      },
    })
    expect(result.isError).toBe(true)
    expect(setSpy).not.toHaveBeenCalled()
    expect(promptSpy).not.toHaveBeenCalled()
    await client.close()
  })

  it("empty sets runs message-only gate and allows prompt when message allow", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "allow", update: "ask" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const hostResult = await agentSessionRegistry.getOrCreateHost(b.id)
    expect(hostResult.ok).toBe(true)
    const hostB = hostResult.entry.host
    hostB.state.sessionId = "s1"
    const setSpy = vi.spyOn(hostB, "setConfigOption")
    const promptSpy = vi.spyOn(hostB, "prompt").mockResolvedValue(undefined)

    const client = await connectMcp(app, {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
    })
    const result = await client.callTool({
      name: "session_send",
      arguments: {
        agent: b.id,
        prompt: "hi",
        sets: {},
        noWait: true,
      },
    })
    expect(result.isError).not.toBe(true)
    expect(setSpy).not.toHaveBeenCalled()
    expect(promptSpy).toHaveBeenCalled()
    await client.close()
  })

  it("mixed MCP send+sets with both ask escalates update before any side effect", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "ask", update: "ask" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)
    expect(hostA).toBeDefined()
    if (!hostA) return
    vi.spyOn(hostA, "requestScopePermission").mockResolvedValue("deny")

    const hostResult = await agentSessionRegistry.getOrCreateHost(b.id)
    expect(hostResult.ok).toBe(true)
    const hostB = hostResult.entry.host
    hostB.state.sessionId = "s1"
    const setSpy = vi.spyOn(hostB, "setConfigOption")
    const promptSpy = vi.spyOn(hostB, "prompt")

    const client = await connectMcp(app, {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
    })
    const result = await client.callTool({
      name: "session_send",
      arguments: {
        agent: b.id,
        prompt: "hi",
        sets: { model: "fast" },
        noWait: true,
      },
    })
    expect(result.isError).toBe(true)
    expect(hostA.requestScopePermission).toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
    expect(promptSpy).not.toHaveBeenCalled()
    await client.close()
  })

  it("per-caller message allow skips prompt when global ask", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "ask" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    await registry.update(a.id, { scopePolicies: { message: "allow" } })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const hostResult = await agentSessionRegistry.getOrCreateHost(b.id)
    expect(hostResult.ok).toBe(true)
    const hostB = hostResult.entry.host
    hostB.state.sessionId = "s1"
    const promptSpy = vi.spyOn(hostB, "prompt").mockResolvedValue(undefined)

    const client = await connectMcp(app, {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
    })
    const result = await client.callTool({
      name: "session_send",
      arguments: { agent: b.id, prompt: "hi", noWait: true },
    })
    expect(result.isError).not.toBe(true)
    expect(promptSpy).toHaveBeenCalled()
    await client.close()
  })

  it("per-caller close deny blocks when global close allow", async () => {
    const { app, registry, deleted } = await makePolicyApp()
    setScopePolicyOverride({ close: "allow" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    await registry.update(a.id, { scopePolicies: { close: "deny" } })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const del = await app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    expect(del.status).toBe(403)
    expect(deleted).not.toContain(b.id)
  })

  it("RPC update deny does not create target host", async () => {
    const { app, registry, agentSessionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ update: "deny" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    await agentSessionRegistry.getOrCreateHost(a.id)
    const createSpy = vi.spyOn(agentSessionRegistry, "getOrCreateHost")

    const res = await app.request(`/api/agents/${b.id}/rpc`, {
      method: "POST",
      headers: {
        [SCOPE_HEADER]: tokenA,
        [AGENT_ID_HEADER]: a.id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: RPC_METHODS.setConfigOption,
        params: { configId: "model", value: "x" },
      }),
    })
    expect(res.status).toBe(403)
    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe("reply grants at the prompt dispatch boundary", () => {
  afterEach(() => {
    resetAllowAlwaysGrantsForTests()
    resetScopePolicyForTests()
    setSelfBaseUrlForTests(undefined)
    vi.restoreAllMocks()
  })

  async function setup() {
    const { app, registry, agentSessionRegistry, connectionRegistry } = await makePolicyApp()
    setScopePolicyOverride({ message: "deny", close: "deny" })
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const c = await registry.create({ cliKind: "cursor", cwd: "/c" })
    const child = await registry.create({ cliKind: "cursor", cwd: "/child", parentAgentId: a.id })
    recordAllowAlwaysGrant(a.id, b.id, "send")

    const hostOf = async (id: string) => {
      const result = await agentSessionRegistry.getOrCreateHost(id)
      if (!result.ok) throw new Error(result.reason)
      return result.entry.host
    }

    const headers = (id?: string, scoped = true) => ({
      ...(id && { [AGENT_ID_HEADER]: id }),
      ...(id && scoped && { [SCOPE_HEADER]: issueToken(id) }),
    })

    const rpc = (
      from: string,
      to: string,
      method: string,
      params: object,
      scoped = true,
      waitMs?: number,
    ) =>
      app.request(`/api/agents/${to}/rpc`, {
        method: "POST",
        headers: { ...headers(from, scoped), "Content-Type": "application/json" },
        body: JSON.stringify({ method, params, waitMs }),
      })

    const mcp = async (
      from: string,
      name: string,
      args: Record<string, unknown>,
      scoped = true,
    ) => {
      const client = await connectMcp(app, headers(from, scoped))
      try {
        return await client.callTool({ name, arguments: args })
      } finally {
        await client.close()
      }
    }

    const send = (surface: "MCP" | "RPC", from: string, to: string, scoped = true) =>
      surface === "MCP"
        ? mcp(from, "session_send", { agent: to, prompt: "hello", timeoutSec: 0.05 }, scoped)
        : rpc(from, to, RPC_METHODS.prompt, { sessionId: "s1", content: "hello" }, scoped, 50)
    const cancel = (from: string, to: string) =>
      rpc(from, to, RPC_METHODS.cancel, { sessionId: "s1" })
    await hostOf(a.id)
    const hostB = await hostOf(b.id)
    return {
      a,
      b,
      c,
      child,
      hostB,
      rpc,
      mcp,
      send,
      cancel,
      registry,
      connectionRegistry,
      agentSessionRegistry,
    }
  }

  it.each(["MCP", "RPC"] as const)(
    "allows a reply while the %s turn is still open",
    async (surface) => {
      const { a, b, c, hostB, send, cancel, mcp } = await setup()
      const started = Promise.withResolvers<void>()
      const turn = Promise.withResolvers<void>()
      vi.spyOn(hostB, "prompt").mockImplementation(() => {
        started.resolve()
        return turn.promise
      })

      const sent = send(surface, a.id, b.id)
      try {
        await started.promise
        if (surface === "MCP") {
          expect(await send("MCP", b.id, a.id)).not.toHaveProperty("isError", true)
          expect(await sent).toMatchObject({ content: [{ text: '{"running":true}' }] })
        } else {
          expect(((await send("RPC", b.id, a.id)) as Response).status).toBe(200)
          expect(await ((await sent) as Response).json()).toMatchObject({ timedOut: true })
        }
        expect((await cancel(b.id, a.id)).status).toBe(202)
        expect((await cancel(b.id, c.id)).status).toBe(403)
        for (const [name, args] of [
          ["session_close", { agent: a.id }],
          ["session_subscribe", { agent: c.id, subscriber: a.id }],
        ] as const) {
          const blocked = await mcp(b.id, name, args)
          expect(blocked.isError).toBe(true)
          expect(JSON.stringify(blocked)).toContain("scope-denied")
        }
      } finally {
        turn.resolve()
        await sent
      }
    },
  )

  it.each(["MCP", "RPC"] as const)(
    "%s host failure before dispatch grants nothing",
    async (surface) => {
      const { a, b, send, cancel, agentSessionRegistry } = await setup()
      vi.spyOn(agentSessionRegistry, "getOrCreateHost").mockResolvedValueOnce({
        ok: false,
        reason: "not-found",
      })
      const failed = await send(surface, a.id, b.id)
      if (surface === "MCP") {
        expect(failed).toHaveProperty("isError", true)
      } else {
        expect((failed as Response).status).toBe(404)
      }
      expect((await cancel(b.id, a.id)).status).toBe(403)
    },
  )

  it.each(["MCP", "RPC"] as const)(
    "%s dispatched prompt rejection preserves the reply grant",
    async (surface) => {
      const { a, b, send, cancel, hostB } = await setup()
      vi.spyOn(hostB, "prompt").mockRejectedValueOnce(new Error("provider rejected prompt"))
      const failed = await send(surface, a.id, b.id)
      if (surface === "MCP") {
        expect(JSON.stringify(failed)).toContain("provider rejected prompt")
      } else {
        expect(await (failed as Response).json()).toMatchObject({
          ok: false,
          error: { message: "provider rejected prompt" },
        })
      }
      expect((await cancel(b.id, a.id)).status).toBe(202)
    },
  )

  it("rejects replies after cancel, invalid params or sends without tokens", async () => {
    const { a, b, rpc, send, cancel, hostB } = await setup()
    const prompt = vi.spyOn(hostB, "prompt")
    expect((await cancel(a.id, b.id)).status).toBe(202)
    expect((await cancel(b.id, a.id)).status).toBe(403)
    expect((await rpc(a.id, b.id, RPC_METHODS.prompt, { sessionId: "s1" })).status).toBe(400)
    expect((await cancel(b.id, a.id)).status).toBe(403)
    expect(prompt).not.toHaveBeenCalled()
    for (const path of ["MCP", "RPC"] as const) {
      await send(path, a.id, b.id, false)
      expect((await cancel(b.id, a.id)).status).toBe(403)
    }
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  it("notify_parent does not grant a reply to the sender", async () => {
    const { a, child, mcp, cancel } = await setup()
    // The parent may already write within the subtree. Use authorizeWrite with
    // an empty graph to isolate the grant that this dispatch must not create.
    expect((await mcp(child.id, "notify_parent", { text: "done" })).isError).toBeUndefined()
    expect(
      await authorizeWrite({
        token: issueToken(a.id),
        targetId: child.id,
        verb: "send",
        agents: [],
        onEscalate: async () => "deny",
      }),
    ).toBe("deny")
    expect((await cancel(a.id, child.id)).status).toBe(202)
  })

  it.each(["caller", "recipient"])(
    "closing the %s clears the issued grant synchronously",
    async (closed) => {
      const { a, b, send, cancel, registry } = await setup()
      await send("MCP", a.id, b.id)
      expect((await cancel(b.id, a.id)).status).toBe(202)
      const closingId = closed === "caller" ? a.id : b.id
      const steps: string[] = []
      const { markClosing, clearGrantsFor } = scope
      vi.spyOn(scope, "markClosing").mockImplementation((id) => {
        steps.push("mark")
        markClosing(id)
      })
      vi.spyOn(scope, "clearGrantsFor").mockImplementation((id) => {
        steps.push("clear")
        clearGrantsFor(id)
      })
      const registryUpdate = registry.update
      vi.spyOn(registry, "update").mockImplementation((id, patch) => {
        steps.push("update")
        return registryUpdate(id, patch)
      })
      vi.spyOn(launcher, "stopAgentUnit").mockReturnValue(true)
      const orchestrator = createAgentOrchestrator({
        registry,
        connectionRegistry: createConnectionRegistry(),
      })
      const close = orchestrator.deleteAndKill(closingId)
      expect(steps).toEqual(["mark", "clear", "update"])
      scope.recordReplyGrant(b.id, a.id)
      scope.recordReplyGrant(a.id, b.id)
      expect((await cancel(b.id, a.id)).status).toBe(403)
      expect(
        await authorizeWrite({
          token: issueToken(a.id),
          targetId: b.id,
          verb: "send",
          agents: [],
          onEscalate: async () => "deny",
        }),
      ).toBe("deny")
      await close
    },
  )
})
