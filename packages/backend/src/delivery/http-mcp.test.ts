/**
 * http-mcp.test.ts — integration tests for POST /api/mcp (slice session-bus-mcp C0).
 *
 * Approach: real MCP Client + StreamableHTTPClientTransport against a Hono
 * app via app.request (no listening port). Two sequential Client sessions
 * prove the per-request transport (a singleton throws on the second request).
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { AgentRegistry } from "@drive-coding/core"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { registerMcpHttp } from "./http-mcp.js"

type HostStub = {
  state: {
    sessionId: string | null
    turnState: string
    modes: unknown
    configOptions: unknown
  }
}

function makeStubSessionRegistry(): AgentSessionRegistry & { hosts: Map<string, HostStub> } {
  const hosts = new Map<string, HostStub>()
  return {
    hosts,
    getHost: vi.fn((id: string) => hosts.get(id)),
    isHeld: vi.fn((id: string) => hosts.has(id)),
    getOrCreateHost: vi.fn(async (id: string) => {
      let host = hosts.get(id)
      if (!host) {
        host = {
          state: {
            sessionId: `sess-${id}`,
            turnState: "idle",
            modes: null,
            configOptions: [],
          },
        }
        hosts.set(id, host)
      }
      return { ok: true, entry: { host, broadcaster: {} } }
    }),
    getBroadcaster: vi.fn(() => undefined),
    unregisterHost: vi.fn((id: string) => {
      hosts.delete(id)
    }),
    notifySessionAttached: vi.fn(async () => {}),
    getCwd: vi.fn(() => undefined),
    getEpoch: vi.fn(() => 0),
    touchOwner: vi.fn(),
    getRuntimeInfo: vi.fn(() => null),
  } as unknown as AgentSessionRegistry & { hosts: Map<string, HostStub> }
}

function makeOrchestrator(registry: AgentRegistry): AgentOrchestrator {
  return {
    createAndSpawn: vi.fn(async (input) => {
      const agent = await registry.create(input)
      return {
        agentId: agent.id,
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        wsUrl: "",
        bridgePort: 0,
        status: "spawning" as const,
      }
    }),
    deleteAndKill: vi.fn(async (id: string) => {
      await registry.delete(id).catch(() => {})
    }),
    getBridgePort: vi.fn(() => 0),
  }
}

function makeApp(opts?: { mcpHttp?: string }) {
  const prev = process.env.MCP_HTTP
  if (opts?.mcpHttp !== undefined) process.env.MCP_HTTP = opts.mcpHttp
  else delete process.env.MCP_HTTP
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const orchestrator = makeOrchestrator(registry)
  const agentSessionRegistry = makeStubSessionRegistry()
  registerMcpHttp(app, { registry, orchestrator, agentSessionRegistry })
  if (prev === undefined) delete process.env.MCP_HTTP
  else process.env.MCP_HTTP = prev
  return { app, registry, orchestrator, agentSessionRegistry }
}

function honoFetch(app: Hono): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    return app.request(req)
  }) as typeof fetch
}

async function connectClient(app: Hono): Promise<Client> {
  const client = new Client({ name: "http-mcp-test", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
    fetch: honoFetch(app),
  })
  await client.connect(transport)
  return client
}

function toolText(result: unknown): string {
  if (typeof result !== "object" || result === null) return ""
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
  const block = content?.find((c) => c.type === "text")
  return block?.text ?? ""
}

function isToolError(result: unknown): boolean {
  return (
    typeof result === "object" && result !== null && "isError" in result && result.isError === true
  )
}

afterEach(() => {
  delete process.env.MCP_HTTP
})

describe("POST /api/mcp (slice session-bus-mcp C0)", () => {
  it("is not 404 when MCP_HTTP is unset (default ON)", async () => {
    const { app } = makeApp()
    const res = await app.request("/api/mcp", { method: "POST" })
    expect(res.status).not.toBe(404)
  })

  it("is 404 when MCP_HTTP=0", async () => {
    const { app } = makeApp({ mcpHttp: "0" })
    const res = await app.request("/api/mcp", { method: "POST" })
    expect(res.status).toBe(404)
  })

  it("real MCP client: initialize + tools/list includes session_list", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const { tools } = await client.listTools()
    await client.close()
    expect(tools.map((t) => t.name).sort()).toEqual(
      expect.arrayContaining(["session_close", "session_list", "session_open"]),
    )
  })

  it("second Client session succeeds (per-request transport, not singleton)", async () => {
    const { app } = makeApp()
    const first = await connectClient(app)
    const listed1 = await first.listTools()
    await first.close()
    const second = await connectClient(app)
    const listed2 = await second.listTools()
    await second.close()
    expect(listed1.tools.map((t) => t.name)).toContain("session_list")
    expect(listed2.tools.map((t) => t.name)).toContain("session_list")
  })

  it("session_list returns agents from the registry", async () => {
    const { app, registry } = makeApp()
    await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-c0" })
    const client = await connectClient(app)
    const result = await client.callTool({ name: "session_list", arguments: {} })
    await client.close()
    expect("isError" in result && result.isError).toBeFalsy()
    const body = JSON.parse(toolText(result)) as {
      agents: Array<{ cliKind: string; cwd: string }>
    }
    expect(body.agents).toHaveLength(1)
    expect(body.agents[0]?.cliKind).toBe("cursor")
    expect(body.agents[0]?.cwd).toBe("/tmp/mcp-c0")
  })

  it("source has no self-call via HTTP", () => {
    const src = readFileSync(fileURLToPath(new URL("./http-mcp.ts", import.meta.url)), "utf8")
    expect(src.match(/fetch\(/g) ?? []).toHaveLength(0)
  })
})

describe("session_open / session_close (slice session-bus-mcp C1)", () => {
  it("session_open maps cli→cliKind, waits for sessionId, returns url", async () => {
    const { app, orchestrator } = makeApp()
    const client = await connectClient(app)
    const result = await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/mcp-c1",
        permission: "allow_once",
        publicUrl: "https://example.test",
      },
    })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as {
      agent: string
      sessionId: string
      url: string
    }
    expect(body.agent).toBeTruthy()
    expect(body.sessionId).toBe(`sess-${body.agent}`)
    expect(body.url).toBe(
      `https://example.test/chat/cursor/${body.sessionId}?sessionTransport=http`,
    )
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cliKind: "cursor",
        cwd: "/tmp/mcp-c1",
        permissionPolicy: "allow_once",
      }),
    )
  })

  it("session_open passes env and parent through to createAndSpawn", async () => {
    const { app, orchestrator } = makeApp()
    const client = await connectClient(app)
    await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/mcp-c1-env",
        env: { FOO: "bar" },
        parent: "parent-agent",
        publicUrl: "http://127.0.0.1:4055",
      },
    })
    await client.close()
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          FOO: "bar",
          DC_PARENT: "parent-agent",
          DC_BASE: "http://127.0.0.1:4055",
          DRIVE_CODING_BASE: "http://127.0.0.1:4055",
        }),
      }),
    )
  })

  it("session_close on idle deletes the agent", async () => {
    const { app, registry } = makeApp()
    const client = await connectClient(app)
    const opened = JSON.parse(
      toolText(
        await client.callTool({
          name: "session_open",
          arguments: { cli: "cursor", cwd: "/tmp/mcp-c1-close" },
        }),
      ),
    ) as { agent: string }
    const closed = await client.callTool({
      name: "session_close",
      arguments: { agent: opened.agent },
    })
    await client.close()
    expect(isToolError(closed)).toBe(false)
    expect(await registry.get(opened.agent)).toBeFalsy()
  })

  it("session_close refuses when turnState is calling-tool unless force", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const client = await connectClient(app)
    const opened = JSON.parse(
      toolText(
        await client.callTool({
          name: "session_open",
          arguments: { cli: "cursor", cwd: "/tmp/mcp-c1-busy" },
        }),
      ),
    ) as { agent: string }
    const host = agentSessionRegistry.hosts.get(opened.agent)
    if (host) host.state.turnState = "calling-tool"

    const refused = await client.callTool({
      name: "session_close",
      arguments: { agent: opened.agent },
    })
    expect(isToolError(refused)).toBe(true)
    expect(toolText(refused)).toMatch(/turnState=calling-tool/)
    expect(await registry.get(opened.agent)).toBeDefined()

    const forced = await client.callTool({
      name: "session_close",
      arguments: { agent: opened.agent, force: true },
    })
    await client.close()
    expect(isToolError(forced)).toBe(false)
    expect(await registry.get(opened.agent)).toBeFalsy()
  })

  it("session_close of a missing agent is already-closed success", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const result = await client.callTool({
      name: "session_close",
      arguments: { agent: "does-not-exist" },
    })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { alreadyClosed?: boolean }
    expect(body.alreadyClosed).toBe(true)
  })
})
