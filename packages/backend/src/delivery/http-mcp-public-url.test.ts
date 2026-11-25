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
import { registerMcpHttp } from "./http-mcp.js"
import { defaultPublicUrl, loopbackBaseUrl } from "./public-url.js"

function makeStubSessionRegistry(): AgentSessionRegistry {
  return {
    getHost: vi.fn((id: string) => ({
      state: { sessionId: `sess-${id}`, turnState: "idle", modes: {}, configOptions: [] },
    })),
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
    stop: vi.fn(),
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
    deleteAllAndKill: vi.fn(async () => ({ closed: [], failed: [] })),
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
    const cfg = {
      port: 4360,
      host: "127.0.0.1",
      publicBaseUrl: "https://public.example.com",
    }
    expect(defaultPublicUrl(cfg)).toBe("https://public.example.com")
    expect(loopbackBaseUrl(cfg)).toBe("http://127.0.0.1:4360")
  })

  it("without PUBLIC_BASE_URL → both return loopback", () => {
    const cfg = { port: 4360, host: "127.0.0.1" }
    expect(defaultPublicUrl(cfg)).toBe("http://127.0.0.1:4360")
    expect(loopbackBaseUrl(cfg)).toBe("http://127.0.0.1:4360")
  })
})

describe("session_open default bases (slice public-base-url)", () => {
  async function open(
    app: Hono,
    name: "session_open" | "agent_open",
    overrides: { publicUrl?: string; base?: string } = {},
  ) {
    const client = new Client({ name: "public-url-test", version: "0.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
      fetch: (async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init)
        return app.request(req)
      }) as typeof fetch,
    })
    await client.connect(transport)
    const result = await client.callTool({
      name,
      arguments: {
        [name === "agent_open" ? "cliKind" : "cli"]: "cursor",
        cwd: "/tmp/public-url-test",
        ...overrides,
      },
    })
    await client.close()
    expect(result.isError).toBeUndefined()
    return result
  }

  function toolText(result: unknown): string {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
    return content?.find((c) => c.type === "text")?.text ?? ""
  }

  const names = ["session_open", "agent_open"] as const
  it.each(names)(
    "with PUBLIC_BASE_URL %s returns public chat URL and loopback child env",
    async (name) => {
      const urlConfig = {
        port: 4360,
        host: "127.0.0.1",
        publicBaseUrl: "https://public.example.com",
      }
      const env: NodeJS.ProcessEnv = {}

      const app = new Hono()
      const registry = createInMemoryAgentRegistry()
      const orchestrator = makeOrchestrator(registry)
      registerMcpHttp(app, {
        registry,
        orchestrator,
        agentSessionRegistry: makeStubSessionRegistry(),
        env,
        urlConfig,
      })

      const result = await open(app, name)
      const identity = name === "agent_open" ? "agentId" : "agent"
      const body = JSON.parse(toolText(result)) as Record<string, string>
      expect(body.url).toBe(
        `https://public.example.com/chat/cursor/sess-${body[identity]}?sessionTransport=http`,
      )
      expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            DRIVE_CODING_BASE: "http://127.0.0.1:4360",
            DC_BASE: "http://127.0.0.1:4360",
          }),
        }),
      )
    },
  )

  it.each(names)("without PUBLIC_BASE_URL %s returns loopback chat URL and env", async (name) => {
    const urlConfig = { port: 4360, host: "127.0.0.1" }
    const env: NodeJS.ProcessEnv = {}

    const app = new Hono()
    const registry = createInMemoryAgentRegistry()
    const orchestrator = makeOrchestrator(registry)
    registerMcpHttp(app, {
      registry,
      orchestrator,
      agentSessionRegistry: makeStubSessionRegistry(),
      env,
      urlConfig,
    })

    const result = await open(app, name)
    const identity = name === "agent_open" ? "agentId" : "agent"
    const body = JSON.parse(toolText(result)) as Record<string, string>
    expect(body.url).toBe(
      `http://127.0.0.1:4360/chat/cursor/sess-${body[identity]}?sessionTransport=http`,
    )
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DRIVE_CODING_BASE: "http://127.0.0.1:4360",
          DC_BASE: "http://127.0.0.1:4360",
        }),
      }),
    )
  })
  it.each([
    {
      name: "session_open",
      base: "https://legacy.example.test/",
      expected: "https://legacy.example.test",
    },
    {
      name: "session_open",
      base: "https://legacy.example.test/",
      publicUrl: "https://public.example.test/",
      expected: "https://public.example.test",
    },
    { name: "agent_open", base: "https://legacy.example.test/", expected: "http://127.0.0.1:4360" },
    {
      name: "agent_open",
      publicUrl: "https://public.example.test/",
      expected: "https://public.example.test",
    },
  ] as const)(
    "$name uses $expected for explicit URL inputs",
    async ({ name, expected, ...overrides }) => {
      const app = new Hono()
      const registry = createInMemoryAgentRegistry()
      const orchestrator = makeOrchestrator(registry)
      registerMcpHttp(app, {
        registry,
        orchestrator,
        agentSessionRegistry: makeStubSessionRegistry(),
        env: {},
        urlConfig: { port: 4360, host: "127.0.0.1" },
      })
      const body = JSON.parse(toolText(await open(app, name, overrides)))
      const id = body[name === "agent_open" ? "agentId" : "agent"]
      expect(body.url).toBe(`${expected}/chat/cursor/sess-${id}?sessionTransport=http`)
      expect(orchestrator.createAndSpawn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          env: expect.objectContaining({ DRIVE_CODING_BASE: expected, DC_BASE: expected }),
        }),
      )
    },
  )
})
