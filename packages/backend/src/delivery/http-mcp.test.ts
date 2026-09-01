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
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { setSelfBaseUrlForTests } from "../instances.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { registerMcpHttp } from "./http-mcp.js"

type HostStub = {
  state: {
    sessionId: string | null
    turnState: string
    modes: unknown
    configOptions: unknown[]
    title: string
    status: string
    lastTurnError: { message: string; at: number } | null
    pending: { permission: null; elicitation: null }
    commands: unknown[]
    messages: Array<{
      id: string
      role: string
      messageId: string | null
      segments: Array<{ id: string; text: string }>
    }>
  }
  prompt: ReturnType<typeof vi.fn>
  setConfigOption: ReturnType<typeof vi.fn>
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
        const created: HostStub = {
          state: {
            sessionId: `sess-${id}`,
            turnState: "idle",
            modes: {
              currentModeId: "ask",
              availableModes: [
                { id: "ask", name: "Ask", description: "Prompt before dangerous operations" },
              ],
            },
            configOptions: [
              {
                id: "model",
                name: "Model",
                description: "Which model to use",
                category: "model",
                type: "select",
                currentValue: "fast",
                options: [{ value: "fast", name: "Fast" }],
              },
            ],
            title: "",
            status: "connected",
            lastTurnError: null,
            pending: { permission: null, elicitation: null },
            commands: [{ name: "huge-commands-blob" }],
            messages: [],
          },
          prompt: vi.fn(),
          setConfigOption: vi.fn(async () => {}),
        }
        created.prompt = vi.fn(async (_sid: string, content: string) => {
          created.state.messages.push({
            id: `m_${created.state.messages.length + 1}`,
            role: "user",
            messageId: null,
            segments: [{ id: "s_u", text: content }],
          })
          created.state.messages.push({
            id: `m_${created.state.messages.length + 1}`,
            role: "assistant",
            messageId: null,
            segments: [{ id: "s_a", text: `echo:${content}` }],
          })
        })
        hosts.set(id, created)
        host = created
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

async function connectClient(app: Hono, headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "http-mcp-test", version: "0.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
    fetch: honoFetch(app),
    requestInit: headers ? { headers } : undefined,
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
  setSelfBaseUrlForTests(undefined)
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
    const version = client.getServerVersion()
    const instructions = client.getInstructions()
    const { tools } = await client.listTools()
    await client.close()
    expect(version?.description).toBeTruthy()
    expect(version?.title).toBeTruthy()
    expect(instructions).toContain("session_open")
    expect(instructions).toContain("configOptions")
    expect(tools.map((t) => t.name).sort()).toEqual([
      "session_close",
      "session_list",
      "session_open",
      "session_send",
      "session_state",
    ])
    const openTool = tools.find((t) => t.name === "session_open")
    const schema = openTool?.inputSchema as { properties?: { cli?: { description?: string } } }
    expect(schema?.properties?.cli?.description).toContain("cliKind")
  })

  it("lists guide resource with usage markdown", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const { resources } = await client.listResources()
    await client.close()
    expect(resources.map((r) => r.uri)).toContain("drive-coding://guide")
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
      agents: Array<{ cliKind: string; cwd: string; displayName?: string }>
    }
    expect(body.agents).toHaveLength(1)
    expect(body.agents[0]?.cliKind).toBe("cursor")
    expect(body.agents[0]?.cwd).toBe("/tmp/mcp-c0")
    expect(body.agents[0]?.displayName).toBe("cursor")
  })

  it("session_list exposes roleLabel via toAgentPublic", async () => {
    const { app, registry } = makeApp()
    await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-role", roleLabel: "executor" })
    const client = await connectClient(app)
    const result = await client.callTool({ name: "session_list", arguments: {} })
    await client.close()
    const body = JSON.parse(toolText(result)) as {
      agents: Array<{ roleLabel?: string }>
    }
    expect(body.agents[0]?.roleLabel).toBe("executor")
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
      cli?: { kind: string; displayName: string }
      hint?: string
      configOptions?: Array<{ id: string; description?: string }>
    }
    expect(body.agent).toBeTruthy()
    expect(body.sessionId).toBe(`sess-${body.agent}`)
    expect(body.url).toBe(
      `https://example.test/chat/cursor/${body.sessionId}?sessionTransport=http`,
    )
    expect(body.cli).toEqual({ kind: "cursor", displayName: "cursor" })
    expect(body.hint).toContain("configOptions")
    expect(body.hint).toContain("session_close")
    expect(body.configOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "model", description: "Which model to use" })]),
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
        parentAgentId: "parent-agent",
      }),
    )
  })

  it("session_open passes closeOnTurnEnd through to createAndSpawn", async () => {
    const { app, orchestrator } = makeApp()
    const client = await connectClient(app)
    await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/mcp-c1-close-flag",
        closeOnTurnEnd: true,
      },
    })
    await client.close()
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ closeOnTurnEnd: true }),
    )
  })

  it("session_open passes systemPrompt through to createAndSpawn", async () => {
    const { app, orchestrator } = makeApp()
    const client = await connectClient(app)
    await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/mcp-charter",
        systemPrompt: "CHARTER_X",
      },
    })
    await client.close()
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "CHARTER_X" }),
    )
  })

  it("session_open passes roleLabel through to createAndSpawn", async () => {
    const { app, orchestrator } = makeApp()
    const client = await connectClient(app)
    await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/mcp-role-label",
        roleLabel: "planner",
      },
    })
    await client.close()
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ roleLabel: "planner" }),
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

describe("session_send / session_state (slice session-bus-mcp C2)", () => {
  async function openCursor(client: Client, cwd: string): Promise<{ agent: string }> {
    const result = await client.callTool({
      name: "session_open",
      arguments: { cli: "cursor", cwd },
    })
    expect(isToolError(result)).toBe(false)
    return JSON.parse(toolText(result)) as { agent: string }
  }

  it("session_send waits for prompt and returns stopReason plus assistant text", async () => {
    const { app, agentSessionRegistry } = makeApp()
    const client = await connectClient(app)
    const opened = await openCursor(client, "/tmp/mcp-c2-send")
    const sent = await client.callTool({
      name: "session_send",
      arguments: { agent: opened.agent, prompt: "hello-c2" },
    })
    await client.close()
    expect(isToolError(sent)).toBe(false)
    const body = JSON.parse(toolText(sent)) as {
      stopReason?: string
      text?: string
      running?: boolean
    }
    expect(body.running).toBeUndefined()
    expect(body.stopReason).toBe("end_turn")
    expect(body.text).toBe("echo:hello-c2")
    const host = agentSessionRegistry.hosts.get(opened.agent)
    expect(host?.prompt).toHaveBeenCalledWith(`sess-${opened.agent}`, "hello-c2")
  })

  it("session_send noWait returns {running:true} without waiting for prompt", async () => {
    const { app, agentSessionRegistry } = makeApp()
    const client = await connectClient(app)
    const opened = await openCursor(client, "/tmp/mcp-c2-nowait")
    const host = agentSessionRegistry.hosts.get(opened.agent)
    let resolvePrompt: () => void = () => {}
    if (host) {
      host.prompt = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve
          }),
      )
    }
    const sent = await client.callTool({
      name: "session_send",
      arguments: { agent: opened.agent, prompt: "later", noWait: true },
    })
    await client.close()
    expect(isToolError(sent)).toBe(false)
    expect(JSON.parse(toolText(sent))).toEqual({ running: true })
    resolvePrompt()
  })

  it("session_send timeout returns {running:true} and leaves the turn running", async () => {
    const { app, agentSessionRegistry } = makeApp()
    const client = await connectClient(app)
    const opened = await openCursor(client, "/tmp/mcp-c2-timeout")
    const host = agentSessionRegistry.hosts.get(opened.agent)
    if (host) host.prompt = vi.fn(() => new Promise(() => {}))
    const sent = await client.callTool({
      name: "session_send",
      arguments: { agent: opened.agent, prompt: "hang", timeoutSec: 0.05 },
    })
    await client.close()
    expect(isToolError(sent)).toBe(false)
    expect(JSON.parse(toolText(sent))).toEqual({ running: true })
  })

  it("session_send applies sets via setConfigOption before prompt", async () => {
    const { app, agentSessionRegistry } = makeApp()
    const client = await connectClient(app)
    const opened = await openCursor(client, "/tmp/mcp-c2-sets")
    await client.callTool({
      name: "session_send",
      arguments: {
        agent: opened.agent,
        prompt: "hi",
        sets: { model: "fast" },
      },
    })
    await client.close()
    const host = agentSessionRegistry.hosts.get(opened.agent)
    expect(host?.setConfigOption).toHaveBeenCalledWith("model", "fast")
    expect(host?.prompt).toHaveBeenCalled()
  })

  it("session_state default omits commands; fields ['*'] includes them", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const opened = await openCursor(client, "/tmp/mcp-c2-state")
    const def = JSON.parse(
      toolText(
        await client.callTool({
          name: "session_state",
          arguments: { agent: opened.agent },
        }),
      ),
    ) as Record<string, unknown>
    expect(def.sessionId).toBe(`sess-${opened.agent}`)
    expect(def.turnState).toBe("idle")
    expect(def).not.toHaveProperty("commands")
    expect(def).not.toHaveProperty("messages")

    const full = JSON.parse(
      toolText(
        await client.callTool({
          name: "session_state",
          arguments: { agent: opened.agent, fields: ["*"] },
        }),
      ),
    ) as { commands?: unknown[] }
    await client.close()
    expect(full.commands).toEqual([{ name: "huge-commands-blob" }])
  })

  it("session_state missing agent is an error", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const result = await client.callTool({
      name: "session_state",
      arguments: { agent: "ghost" },
    })
    await client.close()
    expect(isToolError(result)).toBe(true)
    expect(toolText(result)).toMatch(/agent not found/)
  })
})

describe("agent-identity-mcp (C2/C3)", () => {
  it("session_open derives parentAgentId from X-Drive-Coding-Agent header", async () => {
    const { app, registry, orchestrator } = makeApp()
    const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/parent" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: parent.id })
    await client.callTool({
      name: "session_open",
      arguments: { cli: "cursor", cwd: "/tmp/child", publicUrl: "http://127.0.0.1:4055" },
    })
    await client.close()
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ parentAgentId: parent.id }),
    )
  })

  it("session_open rejects conflicting header parent and explicit parent", async () => {
    const { app, registry } = makeApp()
    const parentA = await registry.create({ cliKind: "cursor", cwd: "/tmp/a" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: parentA.id })
    const result = await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/child",
        parent: "other-parent",
        publicUrl: "http://127.0.0.1:4055",
      },
    })
    await client.close()
    expect(isToolError(result)).toBe(true)
    expect(toolText(result)).toMatch(/conflicts/)
  })

  it("notify_parent appears only for caller with parent", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/parent-np" })
    const child = await registry.create({
      cliKind: "cursor",
      cwd: "/tmp/child-np",
      parentAgentId: parent.id,
    })

    const anonClient = await connectClient(app)
    const anonTools = (await anonClient.listTools()).tools.map((t) => t.name)
    await anonClient.close()
    expect(anonTools).not.toContain("notify_parent")

    const childClient = await connectClient(app, { [AGENT_ID_HEADER]: child.id })
    const childTools = (await childClient.listTools()).tools.map((t) => t.name)
    expect(childTools).toContain("notify_parent")

    const notified = await childClient.callTool({
      name: "notify_parent",
      arguments: { text: "hello parent" },
    })
    await childClient.close()
    expect(isToolError(notified)).toBe(false)
    const parentHost = agentSessionRegistry.hosts.get(parent.id)
    expect(parentHost?.prompt).toHaveBeenCalledWith(`sess-${parent.id}`, "hello parent")
  })
})
