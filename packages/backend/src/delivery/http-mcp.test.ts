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

function makeStubSessionRegistry(): AgentSessionRegistry {
  return {
    getHost: vi.fn(() => undefined),
    isHeld: vi.fn(() => false),
    getOrCreateHost: vi.fn(),
    getBroadcaster: vi.fn(() => undefined),
    unregisterHost: vi.fn(),
    notifySessionAttached: vi.fn(async () => {}),
    getCwd: vi.fn(() => undefined),
    getEpoch: vi.fn(() => 0),
    touchOwner: vi.fn(),
    getRuntimeInfo: vi.fn(() => null),
  } as unknown as AgentSessionRegistry
}

function makeOrchestrator(registry: AgentRegistry): AgentOrchestrator {
  return {
    createAndSpawn: vi.fn(),
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
    expect(tools.map((t) => t.name)).toContain("session_list")
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
