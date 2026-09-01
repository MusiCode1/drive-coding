/**
 * agent-scope.gates.test.ts — §6 gate evidence (slice agent-scopes C2).
 */

import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { AGENT_ID_HEADER } from "../src/agent-identity.js"
import {
  issueToken,
  resetAllowAlwaysGrantsForTests,
  SCOPE_HEADER,
  setScopeEnforcementForTests,
} from "../src/agent-scope.js"
import type { AgentOrchestrator } from "../src/app/agent-orchestrator.js"
import { registerAgentsHttp } from "../src/delivery/http-agents.js"
import { registerMcpHttp } from "../src/delivery/http-mcp.js"
import { SCOPE_DENIED_BODY } from "../src/scope-write.js"
import { setSelfApproveGuardForTests } from "../src/session-host/http/reply.js"
import { bindScopeEnforcement } from "../src/bind-scope-enforcement.js"
import { setSelfBaseUrlForTests } from "../src/instances.js"
import { createAgentSessionRegistry } from "../src/session-host/registry.js"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"
import { registerSessionHostHttp } from "../src/session-host/http/index.js"

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

async function makeScopeGateApp() {
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const deleted: string[] = []

  const connectionRegistry = {
    get: vi.fn((id: string) => makeMockConn(id)),
    getCwd: vi.fn(() => "/tmp/scope-gates"),
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
  registerSessionHostHttp(app, { agentSessionRegistry, agentRegistry: registry })
  registerMcpHttp(app, { registry, orchestrator, agentSessionRegistry, selfBaseUrl: "http://127.0.0.1:4055" })
  setSelfBaseUrlForTests("http://127.0.0.1:4055")

  return { app, registry, agentSessionRegistry, deleted }
}

function honoFetch(app: Hono): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    return app.request(req)
  }) as typeof fetch
}

async function connectMcp(
  app: Hono,
  headers: Record<string, string>,
): Promise<Client> {
  const client = new Client({ name: "scope-gate-test", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:4055/api/mcp"), {
    fetch: honoFetch(app),
    requestInit: { headers },
  })
  await client.connect(transport)
  return client
}

describe("agent-scopes §6 gates", () => {
  afterEach(() => {
    setScopeEnforcementForTests(true)
    setSelfApproveGuardForTests(true)
    resetAllowAlwaysGrantsForTests()
    setSelfBaseUrlForTests(undefined)
  })

  it("gate 1: DELETE without scope token stays allow-all (204)", async () => {
    const { app, registry, deleted } = await makeScopeGateApp()
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })

    const res = await app.request(`/api/agents/${b.id}`, { method: "DELETE" })
    expect(res.status).toBe(204)
    expect(deleted).toEqual([b.id])
  })

  it("gate 2: scoped agent cannot close a stranger (HTTP 403 + MCP isError)", async () => {
    const { app, registry } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    const del = await app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    expect(del.status).toBe(403)
    expect(await del.json()).toEqual(SCOPE_DENIED_BODY)

    const client = await connectMcp(app, {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
    })
    const closeResult = await client.callTool({ name: "session_close", arguments: { agent: b.id } })
    expect(closeResult.isError).toBe(true)
    const mcpText = (closeResult.content?.[0] as { text: string }).text
    const mcpBody = JSON.parse(mcpText) as typeof SCOPE_DENIED_BODY
    expect(mcpBody).toEqual(SCOPE_DENIED_BODY)
    expect(mcpBody.reason.length).toBeGreaterThan(0)
    expect(mcpBody.hint.length).toBeGreaterThan(0)
    await client.close()
  })

  it("G3: MCP hides scope pending, GET /state keeps requestId", async () => {
    const { app, registry, agentSessionRegistry } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)
    expect(hostA).toBeDefined()

    const delPromise = app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })

    await vi.waitFor(() => {
      expect(hostA!.state.pending.permission).not.toBeNull()
    })
    const requestId = hostA!.state.pending.permission!.requestId

    const client = await connectMcp(app, {
      [SCOPE_HEADER]: tokenA,
      [AGENT_ID_HEADER]: a.id,
    })
    const mcpState = await client.callTool({
      name: "session_state",
      arguments: { agent: a.id },
    })
    expect(mcpState.isError).not.toBe(true)
    const parsed = JSON.parse((mcpState.content?.[0] as { text: string }).text) as {
      pending?: { permission?: { requestId?: number } | null }
    }
    expect(parsed.pending?.permission).toBeNull()

    const httpState = await app.request(`/api/agents/${a.id}/state`)
    expect(httpState.status).toBe(200)
    const httpBody = (await httpState.json()) as {
      pending?: { permission?: { requestId?: number } | null }
    }
    expect(httpBody.pending?.permission?.requestId).toBe(requestId)
    await client.close()
    void delPromise
  })

  it("G1: scoped agent cannot self-approve scope escalation", async () => {
    const { app, registry, agentSessionRegistry } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)!
    const respondSpy = vi.spyOn(hostA, "respondPermission")

    const delPromise = app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })

    await vi.waitFor(() => {
      expect(hostA.state.pending.permission).not.toBeNull()
    })
    const requestId = hostA.state.pending.permission!.requestId

    const reply = await app.request(`/api/agents/${a.id}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SCOPE_HEADER]: tokenA,
        [AGENT_ID_HEADER]: a.id,
      },
      body: JSON.stringify({
        kind: "permission",
        requestId,
        result: { outcome: { outcome: "selected", optionId: "scope-allow-once" } },
      }),
    })
    expect(reply.status).toBe(403)
    expect(await reply.json()).toEqual(SCOPE_DENIED_BODY)
    expect(respondSpy).not.toHaveBeenCalled()
    void delPromise
  })

  it("G2: reply without scope token still approves escalation", async () => {
    const { app, registry, agentSessionRegistry, deleted } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)!

    const delPromise = app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })

    await vi.waitFor(() => {
      expect(hostA.state.pending.permission).not.toBeNull()
    })
    const requestId = hostA.state.pending.permission!.requestId

    const reply = await app.request(`/api/agents/${a.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "permission",
        requestId,
        result: { outcome: { outcome: "selected", optionId: "scope-allow-once" } },
      }),
    })
    expect(reply.status).toBe(200)

    const del = await delPromise
    expect(del.status).toBe(204)
    expect(deleted).toContain(b.id)
  })

  it("G5: disabling self-approve guard allows scoped reply", async () => {
    setSelfApproveGuardForTests(false)
    const { app, registry, agentSessionRegistry } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)!

    const delPromise = app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })

    await vi.waitFor(() => {
      expect(hostA.state.pending.permission).not.toBeNull()
    })
    const requestId = hostA.state.pending.permission!.requestId

    const reply = await app.request(`/api/agents/${a.id}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SCOPE_HEADER]: tokenA,
        [AGENT_ID_HEADER]: a.id,
      },
      body: JSON.stringify({
        kind: "permission",
        requestId,
        result: { outcome: { outcome: "selected", optionId: "scope-allow-once" } },
      }),
    })
    expect(reply.status).toBe(200)
    void delPromise
  })

  it("gate 3: escalation allow_once on caller host permits the close", async () => {
    const { app, registry, agentSessionRegistry, deleted } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)

    await agentSessionRegistry.getOrCreateHost(a.id)
    const hostA = agentSessionRegistry.getHost(a.id)
    expect(hostA).toBeDefined()

    const delPromise = app.request(`/api/agents/${b.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })

    await vi.waitFor(() => {
      expect(hostA!.state.pending.permission).not.toBeNull()
    })
    const pending = hostA!.state.pending.permission!
    hostA!.respondPermission(pending.requestId, {
      outcome: { outcome: "selected", optionId: "scope-allow-once" },
    })

    const del = await delPromise
    expect(del.status).toBe(204)
    expect(deleted).toContain(b.id)
  })

  it("gate 4: subtree child closes without pending", async () => {
    const { app, registry, deleted } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const c = await registry.create({
      cliKind: "cursor",
      cwd: "/c",
      parentAgentId: a.id,
    })
    const tokenA = issueToken(a.id)

    const res = await app.request(`/api/agents/${c.id}`, {
      method: "DELETE",
      headers: { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id },
    })
    expect(res.status).toBe(204)
    expect(deleted).toEqual([c.id])
  })

  it("gate 5: disabling enforcement makes gate 2 fail (allow instead of 403)", async () => {
    setScopeEnforcementForTests(false)
    const { app, registry, deleted } = await makeScopeGateApp()
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

  it("gate 6: reads stay open with a scoped token", async () => {
    const { app, registry } = await makeScopeGateApp()
    const a = await registry.create({ cliKind: "cursor", cwd: "/a" })
    const b = await registry.create({ cliKind: "cursor", cwd: "/b" })
    const tokenA = issueToken(a.id)
    const headers = { [SCOPE_HEADER]: tokenA, [AGENT_ID_HEADER]: a.id }

    const list = await app.request("/api/agents", { headers })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { agents: { id: string }[] }
    expect(body.agents.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())

    const client = await connectMcp(app, headers)
    const mcpList = await client.callTool({ name: "session_list", arguments: {} })
    expect(mcpList.isError).not.toBe(true)
    const parsed = JSON.parse((mcpList.content?.[0] as { text: string }).text) as {
      agents: { id: string }[]
    }
    expect(parsed.agents.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())
    await client.close()
  })
})
