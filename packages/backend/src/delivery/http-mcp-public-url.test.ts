/**
 * http-mcp-public-url.test.ts — PUBLIC_BASE_URL split (chat url vs child loopback).
 */

import type { AgentRegistry } from "@drive-coding/core"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { defaultPublicUrl, loopbackBaseUrl } from "./public-url.js"
import { registerMcpHttp } from "./http-mcp.js"

function makeStubSessionRegistry(): AgentSessionRegistry {
  return {
    getHost: vi.fn((id: string) => ({
      state: { sessionId: `sess-${id}`, turnState: "idle", modes: {}, configOptions: [] },
    })),
    isHeld: vi.fn(() => false),
    getOrCreateHost: vi.fn(async (id: string) => ({
      ok: true,
      entry: {
        host: {
          state: { sessionId: `sess-${id}`, turnState: "idle", modes: {}, configOptions: [] },
          prompt: vi.fn(),
          setConfigOption: vi.fn(),
        },
        broadcaster: {},
      },
    })),
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
    deleteAndKill: vi.fn(async () => {}),
    getBridgePort: vi.fn(() => 0),
  }
}

const envBackup: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ["PUBLIC_BASE_URL", "PORT", "DRIVE_CODING_HOST", "MCP_HTTP"]) {
    envBackup[key] = process.env[key]
  }
})

afterEach(() => {
  for (const [key, val] of Object.entries(envBackup)) {
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }
})

describe("defaultPublicUrl / loopbackBaseUrl", () => {
  it("with PUBLIC_BASE_URL → defaultPublicUrl uses it; loopback unchanged", () => {
    process.env.PORT = "4360"
    process.env.DRIVE_CODING_HOST = "127.0.0.1"
    process.env.PUBLIC_BASE_URL = "https://public.example.com"
    expect(defaultPublicUrl()).toBe("https://public.example.com")
    expect(loopbackBaseUrl()).toBe("http://127.0.0.1:4360")
  })

  it("without PUBLIC_BASE_URL → both return loopback", () => {
    delete process.env.PUBLIC_BASE_URL
    process.env.PORT = "4360"
    process.env.DRIVE_CODING_HOST = "127.0.0.1"
    expect(defaultPublicUrl()).toBe("http://127.0.0.1:4360")
    expect(loopbackBaseUrl()).toBe("http://127.0.0.1:4360")
  })
})

describe("session_open default bases (slice public-base-url)", () => {
  async function openWithoutExplicitPublic(app: Hono, orchestrator: AgentOrchestrator) {
    const client = new Client({ name: "public-url-test", version: "0.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
      fetch: (async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init)
        return app.request(req)
      }) as typeof fetch,
    })
    await client.connect(transport)
    const result = await client.callTool({
      name: "session_open",
      arguments: { cli: "cursor", cwd: "/tmp/public-url-test" },
    })
    await client.close()
    return { result, orchestrator }
  }

  function toolText(result: unknown): string {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
    return content?.find((c) => c.type === "text")?.text ?? ""
  }

  it("with PUBLIC_BASE_URL → chat url is public; child env stays loopback", async () => {
    process.env.PUBLIC_BASE_URL = "https://public.example.com"
    process.env.PORT = "4360"
    process.env.DRIVE_CODING_HOST = "127.0.0.1"
    delete process.env.MCP_HTTP

    const app = new Hono()
    const registry = createInMemoryAgentRegistry()
    const orchestrator = makeOrchestrator(registry)
    registerMcpHttp(app, {
      registry,
      orchestrator,
      agentSessionRegistry: makeStubSessionRegistry(),
    })

    const { result, orchestrator: orch } = await openWithoutExplicitPublic(app, orchestrator)
    const body = JSON.parse(toolText(result)) as { url: string; sessionId: string; agent: string }
    expect(body.url).toBe(
      `https://public.example.com/chat/cursor/sess-${body.agent}?sessionTransport=http`,
    )
    expect(orch.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DRIVE_CODING_BASE: "http://127.0.0.1:4360",
          DC_BASE: "http://127.0.0.1:4360",
        }),
      }),
    )
  })

  it("without PUBLIC_BASE_URL → chat url and child env both loopback", async () => {
    delete process.env.PUBLIC_BASE_URL
    process.env.PORT = "4360"
    process.env.DRIVE_CODING_HOST = "127.0.0.1"
    delete process.env.MCP_HTTP

    const app = new Hono()
    const registry = createInMemoryAgentRegistry()
    const orchestrator = makeOrchestrator(registry)
    registerMcpHttp(app, {
      registry,
      orchestrator,
      agentSessionRegistry: makeStubSessionRegistry(),
    })

    const { result, orchestrator: orch } = await openWithoutExplicitPublic(app, orchestrator)
    const body = JSON.parse(toolText(result)) as { url: string; agent: string }
    expect(body.url).toBe(
      `http://127.0.0.1:4360/chat/cursor/sess-${body.agent}?sessionTransport=http`,
    )
    expect(orch.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DRIVE_CODING_BASE: "http://127.0.0.1:4360",
          DC_BASE: "http://127.0.0.1:4360",
        }),
      }),
    )
  })
})
