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
import { AGENT_ID_HEADER } from "../src/agent-identity.js"
import {
  issueToken,
  resetAllowAlwaysGrantsForTests,
  resetScopeSecretForTests,
  SCOPE_HEADER,
  setScopeEnforcementForTests,
} from "../src/agent-scope.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import type { AgentOrchestrator } from "../src/app/agent-orchestrator.js"
import { bindScopeEnforcement } from "../src/bind-scope-enforcement.js"
import { registerAgentsHttp } from "../src/delivery/http-agents.js"
import { registerMcpHttp } from "../src/delivery/http-mcp.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { resetScopePolicyForTests, setScopePolicyOverride } from "../src/scope-policy.js"
import { SCOPE_DENIED_BODY } from "../src/scope-write.js"
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
    isOwnedByWs: vi.fn(() => false),
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
