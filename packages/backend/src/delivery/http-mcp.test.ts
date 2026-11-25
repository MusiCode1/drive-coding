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
import { serializeDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import { CONTRACT_VERSION, PUBLISHED_CONTRACT_VERSION } from "@drive-coding/core/contract-version"
import { DOCS_VERSION } from "@drive-coding/core/docs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as readProcessRssMod from "../adapters/read-process-rss.js"
import { AGENT_ID_HEADER, DRIVE_CODING_AGENT_ID_ENV } from "../agent-identity.js"
import { issueToken, SCOPE_HEADER } from "../agent-scope.js"
import { createInMemoryAgentRegistry } from "../agents/registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { resolveAppVersion } from "../app-version.js"
import { setSelfBaseUrlForTests } from "../instances.js"
import { resetScopePolicyForTests, setScopePolicyOverride } from "../scope-policy.js"
import { createAgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { wrapOrchestratorWithAgentEvents } from "./agent-events-orchestrator.js"
import { registerDocsHttp } from "./http-docs.js"
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
    getCliKind: vi.fn(() => undefined),
    getEpoch: vi.fn(() => 0),
    touchConnection: vi.fn(),
    getRuntimeInfo: vi.fn(() => null),
    getConnectionCount: vi.fn(() => 0),
    stop: vi.fn(),
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
    deleteAllAndKill: vi.fn(async () => ({ closed: [], failed: [] })),
    getBridgePort: vi.fn(() => 0),
  }
}

function makeApp(opts?: {
  mcpHttp?: string
  sidecar?: string
  subscribeOnOpen?: boolean
  noEventBus?: boolean
}) {
  // Hermetic: without this, displayName comes from the machine's ~/.config/drive-coding/cli-specs.jsonc
  // (measured 18/11/2026: a configured machine returned its own display name and failed the test).
  const env: NodeJS.ProcessEnv = {
    CLI_SPECS_FILE: "/nonexistent/drive-coding-test/cli-specs.jsonc",
  }
  env.AGENT_SIDECAR = opts?.sidecar
  if (opts?.mcpHttp !== undefined) env.MCP_HTTP = opts.mcpHttp
  const app = new Hono()
  const registry = createInMemoryAgentRegistry()
  const orchestrator = makeOrchestrator(registry)
  const agentSessionRegistry = makeStubSessionRegistry()
  const eventBus = createAgentEventBus()
  registerMcpHttp(app, {
    registry,
    orchestrator: opts?.subscribeOnOpen
      ? wrapOrchestratorWithAgentEvents(orchestrator, eventBus)
      : orchestrator,
    agentSessionRegistry,
    env,
    urlConfig: { port: 4000, host: "127.0.0.1" },
    eventBus: opts?.noEventBus ? undefined : eventBus,
  })
  return { app, registry, orchestrator, agentSessionRegistry, eventBus }
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

describe("agent docs contract discovery", () => {
  const expectedPublishedVersion = process.env.DC_A1_TEST_PUBLISHED_VERSION
  const contractHeader = "X-Drive-Coding-Contract-Version"

  async function readJsonResource(client: Client, uri: string): Promise<unknown> {
    const { contents } = await client.readResource({ uri })
    expect(contents).toHaveLength(1)
    const [content] = contents
    expect(content).toMatchObject({ uri, mimeType: "application/json" })
    if (content === undefined || !("text" in content) || typeof content.text !== "string") {
      throw new Error(`Expected JSON text at ${uri}`)
    }
    return JSON.parse(content.text)
  }

  async function expectDiscovery(expectedVersion: string | undefined): Promise<void> {
    const { app, registry } = makeApp()
    registerDocsHttp(app)
    const client = await connectClient(app)
    try {
      const appVersion = resolveAppVersion()
      const caller = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-version-probe" })
      const identified = await connectClient(app, { [AGENT_ID_HEADER]: caller.id })
      try {
        for (const name of ["session_whoami", "agent_whoami"]) {
          const result = await identified.callTool({ name, arguments: {} })
          expect(result.isError).toBeUndefined()
          const whoami = JSON.parse(toolText(result))
          expect(whoami.backend.version).toBe(appVersion)
          expect(whoami[name === "agent_whoami" ? "agentId" : "agent"]).toBe(caller.id)
          if (name === "agent_whoami" && expectedVersion !== undefined) {
            expect(whoami.contractVersion).toBe(expectedVersion)
          } else {
            expect(whoami).not.toHaveProperty("contractVersion")
          }
        }
      } finally {
        await identified.close()
      }
      expect(client.getServerVersion()?.version).toBe(appVersion)

      const catalog = await app.request("/api/docs")
      const markdown = await app.request("/api/docs/render-contract")
      const openApi = await app.request("/api/openapi.json")
      for (const [response, route, mime] of [
        [catalog, "/api/docs", "application/json"],
        [markdown, "/api/docs/render-contract", "text/markdown"],
        [openApi, "/api/openapi.json", "application/json"],
      ] as const) {
        expect(response.status, route).toBe(200)
        expect(response.headers.get("content-type")).toContain(mime)
        expect(response.headers.get(contractHeader), route).toBe(expectedVersion ?? null)
      }

      const httpCatalog = (await catalog.json()) as { routeCount: number; generatedAt: string }
      const mcpCatalog = await readJsonResource(client, "drive-coding://docs/index")
      const result = await client.callTool({ name: "docs_get", arguments: {} })
      expect(result.isError).not.toBe(true)
      const toolCatalog: unknown = JSON.parse(toolText(result))
      expect(mcpCatalog).toEqual(httpCatalog)
      expect(toolCatalog).toEqual(httpCatalog)

      const expectedVersionBlock = {
        appVersion,
        docsVersion: DOCS_VERSION,
        routeCount: expect.any(Number),
        generatedAt: expect.any(String),
      }
      expect(httpCatalog).toMatchObject({
        ...expectedVersionBlock,
        docs: expect.arrayContaining([expect.objectContaining({ id: "render-contract" })]),
      })
      expect(markdown.headers.get("X-Drive-Coding-App-Version")).toBe(appVersion)
      expect(markdown.headers.get("X-Drive-Coding-Docs-Version")).toBe(DOCS_VERSION)
      expect(markdown.headers.get("X-Drive-Coding-Route-Count")).toBe(
        String(httpCatalog.routeCount),
      )
      expect(markdown.headers.get("X-Drive-Coding-Generated-At")).toBe(httpCatalog.generatedAt)
      expect(await markdown.text()).toContain("render-contract")
      for (const response of [catalog, openApi]) {
        expect(response.headers.get("X-Drive-Coding-App-Version")).toBeNull()
        expect(response.headers.get("X-Drive-Coding-Docs-Version")).toBeNull()
        expect(response.headers.get("X-Drive-Coding-Route-Count")).toBeNull()
        expect(response.headers.get("X-Drive-Coding-Generated-At")).toBeNull()
      }

      const { "x-drive-coding": httpBlock, ...httpSpec } = (await openApi.json()) as Record<
        string,
        unknown
      >
      const { "x-drive-coding": mcpBlock, ...mcpSpec } = (await readJsonResource(
        client,
        "drive-coding://docs/openapi.json",
      )) as Record<string, unknown>
      const diskSpec: unknown = JSON.parse(
        readFileSync(new URL("../../../../docs/agents/openapi.json", import.meta.url), "utf8"),
      )
      for (const spec of [diskSpec, httpSpec, mcpSpec]) {
        expect(spec).toMatchObject({
          openapi: "3.1.1",
          info: { version: expectedVersion ?? DOCS_VERSION },
        })
      }
      expect(httpSpec).toEqual(diskSpec)
      expect(mcpSpec).toEqual(diskSpec)
      expect(httpBlock).toMatchObject(expectedVersionBlock)
      expect(mcpBlock).toEqual(httpBlock)

      for (const block of [httpCatalog, mcpCatalog, toolCatalog, httpBlock, mcpBlock]) {
        if (expectedVersion === undefined) {
          expect(block).not.toHaveProperty("contractVersion")
        } else {
          expect(block).toHaveProperty("contractVersion", expectedVersion)
        }
      }

      const missing = await app.request("/api/docs/no-such-doc")
      expect(missing.status).toBe(404)
      expect(missing.headers.get("content-type")).toContain("application/json")
      expect(missing.headers.get(contractHeader)).toBeNull()
      expect(await missing.json()).toEqual({ error: "Unknown document id: no-such-doc" })
    } finally {
      await client.close()
    }
  }

  it("keeps the unreleased contract version out of discovery", async () => {
    expect(CONTRACT_VERSION).toBe("2.0.0")
    expect(PUBLISHED_CONTRACT_VERSION).toBeUndefined()
    await expectDiscovery(undefined)
  })

  // Run this case against an isolated source edit and regenerated OpenAPI.
  it.skipIf(expectedPublishedVersion === undefined)(
    "publishes one contract version from the shared source",
    async () => {
      await expectDiscovery(expectedPublishedVersion)
    },
  )
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

  it.each(["root", "child", "no bus"] as const)(
    "discovers the exact MCP roster (%s)",
    async (kind) => {
      const { app, registry } = makeApp({ noEventBus: kind === "no bus" })
      const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-parent" })
      const caller = await registry.create({
        cliKind: "cursor",
        cwd: "/tmp/mcp-child",
        parentAgentId: parent.id,
      })
      const client = await connectClient(
        app,
        kind === "root" ? undefined : { [AGENT_ID_HEADER]: caller.id },
      )
      const { tools } = await client.listTools()
      const version = client.getServerVersion()
      const instructions = client.getInstructions()
      const guide = await client.readResource({ uri: "drive-coding://guide" })
      await client.close()

      expect(version?.description).toBeTruthy()
      expect(version?.title).toBeTruthy()
      expect(instructions).toMatch(/\*\*session_open\*\*.*`cli`.*`cwd`/)
      expect(instructions).toContain("session_send.sets")
      expect(instructions).toContain("session_whoami")
      expect(guide.contents).toEqual([
        {
          uri: "drive-coding://guide",
          mimeType: "text/markdown",
          text: instructions,
        },
      ])

      const pairs = [
        ["session_close", "agent_close"],
        ["session_field_delete", "agent_field_delete"],
        ["session_field_set", "agent_field_set"],
        ["session_list", "agent_list"],
        ["session_note_set", "agent_note_set"],
        ["session_open", "agent_open"],
        ["session_send", "agent_send"],
        ["session_state", "agent_state"],
        ["session_subscribe", "agent_subscribe"],
        ["session_surface", "agent_surface"],
        ["session_whoami", "agent_whoami"],
      ]
      const enabled = pairs.filter(
        ([legacy]) => kind !== "no bus" || legacy !== "session_subscribe",
      )
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [...enabled.flat(), "docs_get", ...(kind === "child" ? ["notify_parent"] : [])].sort(),
      )
      for (const [legacy, canonical] of enabled) {
        expect(tools.find((tool) => tool.name === legacy)?.description).toContain(canonical)
        expect(tools.find((tool) => tool.name === canonical)?.description).toContain(legacy)
      }
      const canonicalOpen = tools.find((tool) => tool.name === "agent_open")
      expect(Object.keys(canonicalOpen?.inputSchema.properties ?? {}).sort()).toEqual(
        [
          "cliKind",
          "cwd",
          "env",
          "permissionPolicy",
          "parentAgentId",
          "closeOnTurnEnd",
          "subscribeOnOpenAgentId",
          "includeLastAssistantText",
          "publicUrl",
          "systemPrompt",
          "roleLabel",
        ].sort(),
      )
      expect(canonicalOpen?.inputSchema.required?.sort()).toEqual(["cliKind", "cwd"])
      const schemas: Record<string, { allowed: string[]; required: string[] }> = {
        agent_send: {
          allowed: ["agentId", "prompt", "sets", "timeoutSec", "noWait"],
          required: ["agentId", "prompt"],
        },
        session_send: {
          allowed: [
            "agent",
            "prompt",
            "sets",
            "timeoutSec",
            "noWait",
            "file",
            "marker",
            "idleTimeoutSec",
            "keep",
          ],
          required: ["agent", "prompt"],
        },
        agent_close: { allowed: ["agentId", "force"], required: ["agentId"] },
        session_close: { allowed: ["agent", "force"], required: ["agent"] },
        agent_state: { allowed: ["agentId", "fields"], required: ["agentId"] },
        session_state: { allowed: ["agent", "fields"], required: ["agent"] },
        agent_subscribe: {
          allowed: ["agentId", "subscriberAgentId", "includeLastAssistantText"],
          required: ["agentId"],
        },
        session_subscribe: {
          allowed: ["agent", "subscriber", "includeLastAssistantText"],
          required: ["agent"],
        },
        session_open: {
          allowed: [
            "cli",
            "cwd",
            "env",
            "permission",
            "parent",
            "closeOnTurnEnd",
            "notifyOnDone",
            "includeLastAssistantText",
            "base",
            "port",
            "json",
            "publicUrl",
            "systemPrompt",
            "roleLabel",
          ],
          required: ["cli", "cwd"],
        },
      }
      for (const prefix of ["session", "agent"]) {
        for (const name of ["list", "whoami", "surface"])
          schemas[`${prefix}_${name}`] = { allowed: [], required: [] }
        schemas[`${prefix}_note_set`] = { allowed: ["text"], required: ["text"] }
        schemas[`${prefix}_field_set`] = { allowed: ["key", "value"], required: ["key", "value"] }
        schemas[`${prefix}_field_delete`] = { allowed: ["key"], required: ["key"] }
      }
      for (const tool of tools) {
        const schema = schemas[tool.name]
        if (!schema) continue
        expect(Object.keys(tool.inputSchema.properties ?? {}).sort(), tool.name).toEqual(
          schema.allowed.sort(),
        )
        expect((tool.inputSchema.required ?? []).sort(), tool.name).toEqual(schema.required.sort())
      }
      const openTool = tools.find((t) => t.name === "session_open")
      const schema = openTool?.inputSchema as { properties?: { cli?: { description?: string } } }
      expect(schema?.properties?.cli?.description).toContain("cliKind")
    },
  )

  it("lists guide resource with usage markdown", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const { resources } = await client.listResources()
    await client.close()
    expect(resources.map((r) => r.uri)).toContain("drive-coding://guide")
  })

  it("lists 21 MCP resources including agent docs catalog", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const { resources } = await client.listResources()
    await client.close()
    const uris = resources.map((r) => r.uri)
    expect(resources).toHaveLength(21)
    expect(uris).toContain("drive-coding://docs/index")
    expect(uris).toContain("drive-coding://docs/render-contract")
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

describe("session_open rollback after spawn", () => {
  it.each(
    [
      { mode: "host unavailable", cause: "session host did not start: not-found" },
      { mode: "dead connection", cause: "session host did not start: conn-dead" },
      { mode: "timeout", cause: "session did not come up within 30s" },
      { mode: "host throws", cause: "handshake failed" },
      { mode: "record remains", cause: "handshake failed", status: "Agent close failed" },
      { mode: "close throws", cause: "handshake failed", status: "Agent close failed" },
      { mode: "lookup throws", cause: "handshake failed", status: "Agent close status unknown" },
    ].flatMap((row) => ["session_open", "agent_open"].map((name) => ({ ...row, name }))),
  )(
    "$name keeps the original error and verifies rollback ($mode)",
    async ({ name, mode, cause, status }) => {
      const { app, registry, orchestrator, agentSessionRegistry } = makeApp()
      const client = await connectClient(app)
      const close = vi.mocked(orchestrator.deleteAndKill)
      let id = ""
      let now = Date.now()
      const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
      vi.mocked(agentSessionRegistry.getOrCreateHost).mockImplementation(async (agentId) => {
        id = agentId
        if (mode === "host unavailable") return { ok: false, reason: "not-found" }
        if (mode === "dead connection") return { ok: false, reason: "conn-dead" }
        if (mode === "timeout") {
          // Advance the polling clock only when the waiter looks up the host.
          vi.mocked(agentSessionRegistry.getHost).mockImplementationOnce(() => {
            now += 31_000
            return undefined
          })
          return { ok: true, entry: {} as never }
        }
        throw new Error(cause)
      })
      if (mode === "record remains") close.mockResolvedValueOnce(undefined)
      if (mode === "close throws") close.mockRejectedValueOnce(new Error("close unavailable"))
      if (mode === "lookup throws") {
        vi.spyOn(registry, "get").mockRejectedValueOnce(new Error("lookup unavailable"))
      }

      try {
        const result = await client.callTool({
          name,
          arguments: { [name === "agent_open" ? "cliKind" : "cli"]: "cursor", cwd: process.cwd() },
        })
        expect(isToolError(result)).toBe(true)
        const classified =
          name === "agent_open" && ["host unavailable", "dead connection"].includes(mode)
        expect(result._meta?.["drive-coding/errorCode"]).toBe(
          classified ? "agent_host_unavailable" : undefined,
        )
        expect(orchestrator.createAndSpawn).toHaveBeenCalledOnce()
        expect(agentSessionRegistry.getOrCreateHost).toHaveBeenCalledOnce()
        expect(id).not.toBe("")
        expect(close).toHaveBeenCalledExactlyOnceWith(id)
        expect(toolText(result)).toContain(cause)
        expect(toolText(result)).toContain(status ?? "Agent removed")
        expect(toolText(result)).toContain(`agent=${id}`)
        if (!status) {
          expect(toolText(result)).toContain("process termination was not verified")
          expect(await registry.get(id)).toBeNull()
        } else if (mode !== "lookup throws") {
          expect(await registry.get(id)).not.toBeNull()
        }
      } finally {
        clock.mockRestore()
        await client.close()
      }
    },
  )
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
      expect.arrayContaining([
        expect.objectContaining({ id: "model", description: "Which model to use" }),
      ]),
    )
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cliKind: "cursor",
        cwd: "/tmp/mcp-c1",
        permissionPolicy: "allow_once",
      }),
    )
  })

  it("counts the MCP base and parent against the sidecar env limit before creating an agent", async () => {
    const { app, orchestrator, registry } = makeApp({ sidecar: "cursor" })
    const client = await connectClient(app)
    try {
      const result = await client.callTool({
        name: "session_open",
        arguments: {
          cli: "cursor",
          cwd: "/tmp",
          env: { PADDING: "x".repeat(46_000) },
          base: "http://127.0.0.1:4000",
          parent: "synthetic-parent",
        },
      })
      expect(isToolError(result)).toBe(true)
      expect(toolText(result)).toMatch(/^agent env too large: \d+ > 61440 \(encoded\)$/)
      expect(orchestrator.createAndSpawn).not.toHaveBeenCalled()
      expect(await registry.list()).toEqual([])
    } finally {
      await client.close()
    }
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

  it("session_open passes notifyOnDone through to createAndSpawn", async () => {
    const { app, orchestrator } = makeApp()
    const subscriberId = "00000000-0000-4000-8000-000000000099"
    const client = await connectClient(app)
    await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/mcp-c1-notify-done",
        notifyOnDone: subscriberId,
      },
    })
    await client.close()
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ notifyOnDone: subscriberId }),
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

  it("session_open passes notifyOnDone and includeLastAssistantText through to createAndSpawn", async () => {
    const { app, orchestrator } = makeApp()
    const subscriberId = "00000000-0000-4000-8000-000000000088"
    const client = await connectClient(app)
    await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/mcp-c1-notify-text",
        notifyOnDone: subscriberId,
        includeLastAssistantText: true,
      },
    })
    await client.close()
    expect(orchestrator.createAndSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyOnDone: subscriberId,
        includeLastAssistantText: true,
      }),
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
  it("tools/list describes how session_open resolves a parent", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    try {
      const { tools } = await client.listTools()
      const description = tools.find((tool) => tool.name === "session_open")?.inputSchema.properties
        ?.parent
      expect(description).toMatchObject({
        description: expect.stringMatching(
          /X-Drive-Coding-Agent identifies a registered agent.*must match.*Otherwise, the explicit parent is used/,
        ),
      })
    } finally {
      await client.close()
    }
  })

  it.each([
    { caller: "registered", parentArg: undefined, expected: "registered" },
    { caller: "registered", parentArg: "", expected: "registered" },
    { caller: "registered", parentArg: "registered", expected: "registered" },
    { caller: "unknown", parentArg: "explicit", expected: "explicit" },
    { caller: "unknown", parentArg: undefined, expected: undefined },
    { caller: "token", parentArg: undefined, expected: undefined },
    { caller: "anonymous", parentArg: undefined, expected: undefined },
  ] as const)(
    "session_open resolves parent for $caller caller with parent $parentArg",
    async (row) => {
      const { app, registry, orchestrator, eventBus } = makeApp({ subscribeOnOpen: true })
      const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/parent" })
      const subscriber = await registry.create({ cliKind: "cursor", cwd: "/tmp/subscriber" })
      const headers = {
        registered: { [AGENT_ID_HEADER]: ` ${parent.id} ` },
        unknown: { [AGENT_ID_HEADER]: "unregistered-agent" },
        token: { [SCOPE_HEADER]: issueToken(parent.id) },
        anonymous: {},
      }
      const client = await connectClient(app, headers[row.caller])
      const expectedParent = row.expected === "registered" ? parent.id : row.expected
      const result = await client.callTool({
        name: "session_open",
        arguments: {
          cli: "cursor",
          cwd: "/tmp/child",
          ...(row.parentArg === undefined
            ? {}
            : { parent: row.parentArg === "registered" ? parent.id : row.parentArg }),
          env: { DC_PARENT: "legacy" },
          notifyOnDone: subscriber.id,
        },
      })
      await client.close()
      expect(isToolError(result)).toBe(false)
      expect(orchestrator.createAndSpawn).toHaveBeenCalledOnce()
      const input = vi.mocked(orchestrator.createAndSpawn).mock.calls[0]?.[0]
      expect(input?.parentAgentId).toBe(expectedParent)
      expect(input?.env?.DC_PARENT).toBe(expectedParent ?? "legacy")
      const { agent } = JSON.parse(toolText(result)) as { agent: string }
      const child = await registry.get(agent)
      expect(child?.id).toBe(agent)
      expect(child?.parentAgentId).toBe(expectedParent)
      expect(eventBus.subscribersOf(agent)).toEqual([subscriber.id])

      const childClient = await connectClient(app, { [AGENT_ID_HEADER]: agent })
      try {
        const whoami = await childClient.callTool({ name: "session_whoami", arguments: {} })
        expect(isToolError(whoami)).toBe(false)
        expect(JSON.parse(toolText(whoami))).toMatchObject({
          hasParent: expectedParent !== undefined,
        })
        const { tools } = await childClient.listTools()
        expect(tools.some((tool) => tool.name === "notify_parent")).toBe(
          expectedParent !== undefined,
        )
      } finally {
        await childClient.close()
      }
    },
  )

  it("session_open rejects conflicting header parent and explicit parent", async () => {
    const { app, registry, orchestrator, agentSessionRegistry, eventBus } = makeApp({
      subscribeOnOpen: true,
    })
    const parentA = await registry.create({ cliKind: "cursor", cwd: "/tmp/a" })
    const parentB = await registry.create({ cliKind: "cursor", cwd: "/tmp/b" })
    const before = await registry.list()
    const subscribe = vi.spyOn(eventBus, "subscribe")
    const client = await connectClient(app, { [AGENT_ID_HEADER]: parentA.id })
    const result = await client.callTool({
      name: "session_open",
      arguments: {
        cli: "cursor",
        cwd: "/tmp/child",
        parent: parentB.id,
        notifyOnDone: parentB.id,
        publicUrl: "http://127.0.0.1:4055",
      },
    })
    await client.close()
    expect(isToolError(result)).toBe(true)
    expect(toolText(result)).toContain(
      `${AGENT_ID_HEADER} (${parentA.id}) conflicts with explicit parent (${parentB.id})`,
    )
    expect(orchestrator.createAndSpawn).not.toHaveBeenCalled()
    expect(agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(await registry.list()).toEqual(before)
  })

  it("session_subscribe registers a subscriber on the event bus", async () => {
    const { app, registry } = makeApp()
    const target = await registry.create({ cliKind: "cursor", cwd: "/tmp/target-sub" })
    const subscriber = await registry.create({ cliKind: "cursor", cwd: "/tmp/subscriber" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: subscriber.id })
    const result = await client.callTool({
      name: "session_subscribe",
      arguments: { agent: target.id },
    })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { ok: boolean; agent: string; subscriber: string }
    expect(body.ok).toBe(true)
    expect(body.agent).toBe(target.id)
    expect(body.subscriber).toBe(subscriber.id)
  })

  it("session_subscribe without includeLastAssistantText defaults options to false", async () => {
    const { app, registry, eventBus } = makeApp()
    const target = await registry.create({ cliKind: "cursor", cwd: "/tmp/target-sub-default" })
    const subscriber = await registry.create({ cliKind: "cursor", cwd: "/tmp/subscriber-default" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: subscriber.id })
    await client.callTool({
      name: "session_subscribe",
      arguments: { agent: target.id },
    })
    await client.close()
    expect(eventBus.optionsOf(target.id, subscriber.id)).toEqual({
      includeLastAssistantText: false,
    })
  })

  it("session_subscribe with includeLastAssistantText sets bus options", async () => {
    const { app, registry, eventBus } = makeApp()
    const target = await registry.create({ cliKind: "cursor", cwd: "/tmp/target-sub-flag" })
    const subscriber = await registry.create({ cliKind: "cursor", cwd: "/tmp/subscriber-flag" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: subscriber.id })
    await client.callTool({
      name: "session_subscribe",
      arguments: { agent: target.id, includeLastAssistantText: true },
    })
    await client.close()
    expect(eventBus.optionsOf(target.id, subscriber.id)).toEqual({
      includeLastAssistantText: true,
    })
  })

  it("notify_parent appears only for caller with parent", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/parent-np" })
    const child = await registry.create({
      cliKind: "cursor",
      cwd: "/tmp/child-np",
      parentAgentId: parent.id,
    })

    for (const headers of [
      undefined,
      { [AGENT_ID_HEADER]: parent.id },
      {
        [AGENT_ID_HEADER]: "unregistered-agent",
      },
    ]) {
      const nonChildClient = await connectClient(app, headers)
      const nonChildTools = (await nonChildClient.listTools()).tools.map((t) => t.name)
      await nonChildClient.close()
      expect(nonChildTools).not.toContain("notify_parent")
    }

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
    expect(parentHost?.prompt).toHaveBeenCalledOnce()
    const delivered = String(parentHost?.prompt.mock.calls[0]?.[1] ?? "")
    expect(delivered).toContain("hello parent")
    expect(delivered).toContain(child.id)
    expect(delivered).toContain("<drive-coding-msg")
  })

  it("session_send wraps prompt when caller identity header resolves", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const caller = await registry.create({
      cliKind: "cursor",
      cwd: "/tmp/caller-wrap",
      roleLabel: "caller-role",
    })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: caller.id })
    const openedResult = await client.callTool({
      name: "session_open",
      arguments: { cli: "cursor", cwd: "/tmp/target-wrap" },
    })
    const opened = JSON.parse(toolText(openedResult)) as { agent: string }
    await client.callTool({
      name: "session_send",
      arguments: { agent: opened.agent, prompt: "payload", noWait: true },
    })
    await client.close()
    const host = agentSessionRegistry.hosts.get(opened.agent)
    expect(host?.prompt).toHaveBeenCalledOnce()
    const delivered = String(host?.prompt.mock.calls[0]?.[1] ?? "")
    expect(delivered).toContain("<drive-coding-msg")
    expect(delivered).toContain(caller.id)
    expect(delivered).toContain("caller-role")
    expect(delivered).toContain("payload")
  })

  it("session_send leaves prompt plain without resolved caller", async () => {
    const { app, agentSessionRegistry } = makeApp()
    const client = await connectClient(app, {
      [AGENT_ID_HEADER]: "00000000-0000-4000-8000-000000000099",
    })
    const openedResult = await client.callTool({
      name: "session_open",
      arguments: { cli: "cursor", cwd: "/tmp/anon-send" },
    })
    const opened = JSON.parse(toolText(openedResult)) as { agent: string }
    await client.callTool({
      name: "session_send",
      arguments: { agent: opened.agent, prompt: "plain-only", noWait: true },
    })
    await client.close()
    const host = agentSessionRegistry.hosts.get(opened.agent)
    expect(host?.prompt).toHaveBeenCalledWith(`sess-${opened.agent}`, "plain-only")
  })
})

describe("session_whoami (slice mcp-whoami)", () => {
  afterEach(() => {
    delete process.env[DRIVE_CODING_AGENT_ID_ENV]
  })

  it("listTools includes session_whoami without caller header", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const { tools } = await client.listTools()
    await client.close()
    expect(tools.map((t) => t.name)).toContain("session_whoami")
  })

  it("without header returns isError", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(true)
    expect(toolText(result)).toMatch(new RegExp(AGENT_ID_HEADER))
  })

  it("unknown header id returns isError", async () => {
    const { app } = makeApp()
    const client = await connectClient(app, {
      [AGENT_ID_HEADER]: "00000000-0000-4000-8000-000000000099",
    })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(true)
  })

  it("registered caller returns agent equal to header uuid", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-self" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as {
      agent: string
      cliKind: string
      cwd: string
      hasParent: boolean
    }
    expect(body.agent).toBe(agent.id)
    expect(body.cliKind).toBe("cursor")
    expect(body.cwd).toBe("/tmp/whoami-self")
    expect(body.hasParent).toBe(false)
  })

  it("two agents: header of A returns A.id not B.id", async () => {
    const { app, registry } = makeApp()
    const agentA = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-a" })
    await registry.create({ cliKind: "codex", cwd: "/tmp/whoami-b" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agentA.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { agent: string; cliKind: string }
    expect(body.agent).toBe(agentA.id)
    expect(body.cliKind).toBe("cursor")
  })

  it("ENV DRIVE_CODING_AGENT_ID alone does not invent identity", async () => {
    const { app, registry } = makeApp()
    const agentA = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-env" })
    const envOnlyId = "00000000-0000-4000-8000-000000000088"
    process.env[DRIVE_CODING_AGENT_ID_ENV] = envOnlyId

    const anonClient = await connectClient(app)
    const anonResult = await anonClient.callTool({ name: "session_whoami", arguments: {} })
    await anonClient.close()
    expect(isToolError(anonResult)).toBe(true)

    const headerClient = await connectClient(app, { [AGENT_ID_HEADER]: agentA.id })
    const headerResult = await headerClient.callTool({ name: "session_whoami", arguments: {} })
    await headerClient.close()
    expect(isToolError(headerResult)).toBe(false)
    const body = JSON.parse(toolText(headerResult)) as { agent: string }
    expect(body.agent).toBe(agentA.id)
    expect(body.agent).not.toBe(envOnlyId)
  })

  it("includes parentAgentId and sessionId when present", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-parent" })
    const child = await registry.create({
      cliKind: "cursor",
      cwd: "/tmp/whoami-child",
      parentAgentId: parent.id,
    })
    agentSessionRegistry.hosts.set(child.id, {
      state: {
        sessionId: `sess-${child.id}`,
        turnState: "idle",
        modes: {},
        configOptions: [],
        title: "",
        status: "connected",
        lastTurnError: null,
        pending: { permission: null, elicitation: null },
        commands: [],
        messages: [],
      },
      prompt: vi.fn(),
      setConfigOption: vi.fn(),
    })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: child.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as {
      agent: string
      hasParent: boolean
      parentAgentId?: string
      sessionId?: string
    }
    expect(body.agent).toBe(child.id)
    expect(body.hasParent).toBe(true)
    expect(body.parentAgentId).toBe(parent.id)
    expect(body.sessionId).toBe(`sess-${child.id}`)
  })

  it("includes openedByEmail when present on caller record", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({
      cliKind: "cursor",
      cwd: "/tmp/whoami-email",
      openedByEmail: "user@example.com",
    })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { openedByEmail?: string }
    expect(body.openedByEmail).toBe("user@example.com")
  })

  it("omits openedByEmail when not set on caller record", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-no-email" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { openedByEmail?: string }
    expect(body).not.toHaveProperty("openedByEmail")
  })
})

describe("session_whoami runtime envelope (slice mcp-whoami-runtime)", () => {
  it("includes backend.pid equal to process.pid and backend.memory.rssMB > 0", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-backend" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as {
      agent: string
      backend?: {
        pid: number
        port: number
        memory?: { rssMB: number; heapUsedMB: number; rssBudgetMB: number; overBudget: boolean }
      }
    }
    expect(body.agent).toBe(agent.id)
    expect(body.backend?.pid).toBe(process.pid)
    expect(typeof body.backend?.memory?.rssMB).toBe("number")
    expect(body.backend?.memory?.rssMB).toBeGreaterThan(0)
    expect(body.backend?.port).toBe(4000)
  })

  it("backend.port comes from urlConfig not getSelfBaseUrl", async () => {
    const env: NodeJS.ProcessEnv = {}
    const app = new Hono()
    const registry = createInMemoryAgentRegistry()
    registerMcpHttp(app, {
      registry,
      orchestrator: makeOrchestrator(registry),
      agentSessionRegistry: makeStubSessionRegistry(),
      env,
      urlConfig: { port: 4007, host: "127.0.0.1" },
      eventBus: createAgentEventBus(),
    })
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-port" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { backend?: { port: number } }
    expect(body.backend?.port).toBe(4007)
  })

  it("with cli running: runtime.cliPid is a number and memory has proc source", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-runtime" })
    vi.mocked(agentSessionRegistry.getRuntimeInfo).mockReturnValue({
      pid: 250735,
      attached: true,
      busy: false,
      lastMessageAt: Date.now(),
      lastSeenAt: Date.now(),
      via: "http",
    })
    const rssSpy = vi
      .spyOn(readProcessRssMod, "readProcessRss")
      .mockReturnValue({ rssMB: 1840, source: "proc" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    rssSpy.mockRestore()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as {
      runtime?: {
        cliPid: number
        attached: boolean
        busy: boolean
        via: string
        memory: { rssMB: number; source: string } | null
        source?: string
      }
    }
    expect(typeof body.runtime?.cliPid).toBe("number")
    expect(body.runtime?.cliPid).toBe(250735)
    expect(body.runtime?.attached).toBe(true)
    expect(body.runtime?.via).toBe("http")
    expect(body.runtime?.memory).toEqual(
      expect.objectContaining({ rssMB: expect.any(Number), source: "proc" }),
    )
    expect(body.runtime).not.toHaveProperty("memorySource")
  })

  it("without runtime info: runtime.memory null and source unavailable", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-no-rt" })
    vi.mocked(agentSessionRegistry.getRuntimeInfo).mockReturnValue(null)
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as {
      runtime?: { cliPid: null; memory: null; source: string }
    }
    expect(body.runtime?.cliPid).toBeNull()
    expect(body.runtime?.memory).toBeNull()
    expect(body.runtime?.source).toBe("unavailable")
  })

  it("publicBaseUrl omitted when urlConfig.publicBaseUrl unset", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-pub" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { backend?: { publicBaseUrl?: string } }
    expect(body.backend).toBeDefined()
    expect(body.backend).not.toHaveProperty("publicBaseUrl")
  })

  it("publicBaseUrl from urlConfig when set", async () => {
    const env: NodeJS.ProcessEnv = {}
    const app = new Hono()
    const registry = createInMemoryAgentRegistry()
    registerMcpHttp(app, {
      registry,
      orchestrator: makeOrchestrator(registry),
      agentSessionRegistry: makeStubSessionRegistry(),
      env,
      urlConfig: { port: 4000, host: "127.0.0.1", publicBaseUrl: "https://public.example.com" },
      eventBus: createAgentEventBus(),
    })
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/whoami-pub-set" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(false)
    const body = JSON.parse(toolText(result)) as { backend?: { publicBaseUrl?: string } }
    expect(body.backend?.publicBaseUrl).toBe("https://public.example.com")
  })
})

describe("session_surface (slice mcp-surface-tool)", () => {
  afterEach(() => {
    delete process.env[DRIVE_CODING_AGENT_ID_ENV]
  })

  it("listTools includes session_surface without caller header", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const { tools } = await client.listTools()
    await client.close()
    expect(tools.map((t) => t.name)).toContain("session_surface")
  })

  it("without header returns isError", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const result = await client.callTool({ name: "session_surface", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(true)
    expect(toolText(result)).toMatch(new RegExp(AGENT_ID_HEADER))
  })

  it("unknown header id returns isError", async () => {
    const { app } = makeApp()
    const client = await connectClient(app, {
      [AGENT_ID_HEADER]: "00000000-0000-4000-8000-000000000098",
    })
    const result = await client.callTool({ name: "session_surface", arguments: {} })
    await client.close()
    expect(isToolError(result)).toBe(true)
  })

  it("registered caller gets the surface prompt as plain text", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/surface-self" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })
    const result = await client.callTool({ name: "session_surface", arguments: {} })
    await client.close()

    expect(isToolError(result)).toBe(false)
    const text = toolText(result)
    // The caller must be able to act on this without a second lookup:
    // who it is, how to reach the BE, and how to hand the user a file.
    expect(text).toContain(agent.id)
    expect(text).toContain("/api/mcp")
    expect(text).toContain("/api/fs/file")
    // Text, not JSON — a stringified body would escape every newline.
    expect(text).not.toMatch(/^\s*[{[]/)
    expect(text).toContain("\n")
  })
})

describe("session memory MCP tools (slice session-memory C1)", () => {
  it("session_note_set without header returns isError", async () => {
    const { app } = makeApp()
    const client = await connectClient(app)
    const result = await client.callTool({
      name: "session_note_set",
      arguments: { text: "hello" },
    })
    await client.close()
    expect(isToolError(result)).toBe(true)
    expect(toolText(result)).toMatch(new RegExp(AGENT_ID_HEADER))
  })

  it("session_note_set with header → whoami returns userNotes", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/memory-note" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })

    const setResult = await client.callTool({
      name: "session_note_set",
      arguments: { text: "shared note" },
    })
    expect(isToolError(setResult)).toBe(false)

    const whoami = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    expect(isToolError(whoami)).toBe(false)
    const body = JSON.parse(toolText(whoami)) as { userNotes?: string }
    expect(body.userNotes).toBe("shared note")
  })

  it("session_field_set merges keys without replacing the map", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/memory-fields" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })

    await client.callTool({
      name: "session_field_set",
      arguments: { key: "a", value: "1" },
    })
    await client.callTool({
      name: "session_field_set",
      arguments: { key: "b", value: "2" },
    })

    const whoami = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    const body = JSON.parse(toolText(whoami)) as { sessionFields?: Record<string, string> }
    expect(body.sessionFields).toEqual({ a: "1", b: "2" })
  })

  it("session_field_delete removes one key", async () => {
    const { app, registry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/memory-delete" })
    await registry.update(agent.id, { sessionFields: { keep: "yes", drop: "no" } })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: agent.id })

    await client.callTool({
      name: "session_field_delete",
      arguments: { key: "drop" },
    })

    const whoami = await client.callTool({ name: "session_whoami", arguments: {} })
    await client.close()
    const body = JSON.parse(toolText(whoami)) as { sessionFields?: Record<string, string> }
    expect(body.sessionFields).toEqual({ keep: "yes" })
  })
})

// Merge regression: both policies must run before an enveloped send has effects.
describe("scoped envelope MCP integration", () => {
  afterEach(resetScopePolicyForTests)

  it.each(
    (
      [
        { update: "deny", message: "allow", allowed: false },
        { update: "allow", message: "deny", allowed: false },
        { update: "allow", message: "allow", allowed: true },
      ] as const
    ).flatMap((row) => (["session_send", "agent_send"] as const).map((name) => ({ ...row, name }))),
  )("$name update=$update message=$message", async ({ update, message, allowed, name }) => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const caller = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-caller" })
    const target = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-target" })
    setScopePolicyOverride({ update, message })
    const client = await connectClient(app, {
      [AGENT_ID_HEADER]: caller.id,
      [SCOPE_HEADER]: issueToken(caller.id),
    })
    const prompt = "merge & <body>"
    try {
      const result = await client.callTool({
        name,
        arguments: {
          [name === "agent_send" ? "agentId" : "agent"]: target.id,
          prompt,
          sets: { model: "fast" },
          noWait: true,
        },
      })
      expect(isToolError(result)).toBe(!allowed)
      if (!allowed) {
        expect(result._meta).toBeUndefined()
        expect(JSON.parse(toolText(result))).toMatchObject({ error: "scope-denied" })
        expect(agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()
        expect(agentSessionRegistry.hosts.size).toBe(0)
      } else {
        const host = agentSessionRegistry.hosts.get(target.id)
        expect(host?.setConfigOption).toHaveBeenCalledExactlyOnceWith("model", "fast")
        expect(host?.setConfigOption).toHaveBeenCalledBefore(host?.prompt ?? vi.fn())
        expect(host?.prompt).toHaveBeenCalledExactlyOnceWith(
          `sess-${target.id}`,
          serializeDriveMessage({
            source: "agent",
            sender: { id: caller.id },
            body: prompt,
          }),
        )
      }
    } finally {
      await client.close()
    }
  })
})

describe("canonical agent tools over Streamable HTTP", () => {
  it("opens with canonical inputs and a registered parent, then notifies and closes once", async () => {
    const { app, registry, orchestrator, agentSessionRegistry, eventBus } = makeApp({
      subscribeOnOpen: true,
    })
    const parent = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-parent" })
    const stranger = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-other" })
    const client = await connectClient(app, { [AGENT_ID_HEADER]: ` ${parent.id} ` })
    try {
      const contradicted = await client.callTool({
        name: "agent_open",
        arguments: { cliKind: "cursor", cwd: "/tmp/mcp-child", parentAgentId: stranger.id },
      })
      expect(contradicted.isError).toBe(true)
      expect(contradicted._meta).toBeUndefined()
      expect(orchestrator.createAndSpawn).not.toHaveBeenCalled()
      expect(agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()

      const invalid = await client.callTool({
        name: "agent_open",
        arguments: { cli: "cursor", cwd: "/tmp/mcp-child" },
      })
      expect(invalid.isError).toBe(true)
      expect(invalid._meta).toBeUndefined()
      expect(orchestrator.createAndSpawn).not.toHaveBeenCalled()

      const opened = await client.callTool({
        name: "agent_open",
        arguments: {
          cliKind: "cursor",
          cli: "codex",
          cwd: "/tmp/mcp-child",
          parentAgentId: parent.id,
          parent: stranger.id,
          permissionPolicy: "allow_once",
          permission: "reject_once",
          subscribeOnOpenAgentId: parent.id,
          notifyOnDone: stranger.id,
          includeLastAssistantText: true,
        },
      })
      expect(opened.isError).toBeUndefined()
      const body = JSON.parse(toolText(opened))
      const id: string = body.agentId
      expect(id).toEqual(expect.any(String))
      expect(body).not.toHaveProperty("agent")
      expect(body.sessionId).toBe(`sess-${id}`)
      expect(body.url).toContain("?sessionTransport=http")
      expect(body.hint).toMatch(
        /agentId.*as agent in session_state, session_send and session_close/,
      )
      expect(body.hint).toContain("session_send.sets")
      expect(orchestrator.createAndSpawn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          cliKind: "cursor",
          permissionPolicy: "allow_once",
          parentAgentId: parent.id,
          notifyOnDone: parent.id,
          includeLastAssistantText: true,
        }),
      )
      expect(agentSessionRegistry.getOrCreateHost).toHaveBeenCalledExactlyOnceWith(id)
      expect(eventBus.subscribersOf(id)).toEqual([parent.id])
      const child = await connectClient(app, { [AGENT_ID_HEADER]: id })
      try {
        const { tools } = await child.listTools()
        expect(tools.filter(({ name }) => name === "notify_parent")).toHaveLength(1)
        const reply = await child.callTool({ name: "notify_parent", arguments: { text: "ready" } })
        expect(JSON.parse(toolText(reply))).toEqual({ ok: true, parent: parent.id })
        expect(agentSessionRegistry.hosts.get(parent.id)?.prompt).toHaveBeenCalledOnce()
      } finally {
        await child.close()
      }
      const grandchild = await registry.create({
        cliKind: "cursor",
        cwd: "/tmp/mcp-grandchild",
        parentAgentId: id,
      })
      const host = agentSessionRegistry.hosts.get(id)
      if (!host) throw new Error("expected opened host")
      host.state.turnState = "calling-tool"
      const busy = await client.callTool({ name: "agent_close", arguments: { agentId: id } })
      expect(busy.isError).toBe(true)
      expect(busy._meta).toBeUndefined()
      expect(orchestrator.deleteAndKill).not.toHaveBeenCalled()
      const closed = await client.callTool({
        name: "agent_close",
        arguments: { agentId: id, force: true },
      })
      expect(JSON.parse(toolText(closed))).toEqual({ ok: true, agentId: id })
      expect(orchestrator.deleteAndKill).toHaveBeenCalledExactlyOnceWith(id)
      expect(await registry.get(grandchild.id)).not.toBeNull()
      const repeated = await client.callTool({ name: "agent_close", arguments: { agentId: id } })
      expect(JSON.parse(toolText(repeated))).toEqual({ ok: true, agentId: id, alreadyClosed: true })
      expect(orchestrator.deleteAndKill).toHaveBeenCalledOnce()
    } finally {
      await client.close()
    }
  })

  it("projects a single record into both vocabularies and keeps empty metadata", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const caller = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-projection" })
    await registry.update(caller.id, { userNotes: "", sessionFields: {} })
    await agentSessionRegistry.getOrCreateHost(caller.id)
    vi.mocked(agentSessionRegistry.getConnectionCount).mockReturnValue(3)
    const client = await connectClient(app, { [AGENT_ID_HEADER]: caller.id })
    const read = async (name: string, args = {}) => {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError).toBeUndefined()
      return JSON.parse(toolText(result))
    }
    try {
      const legacy = await read("session_list")
      const canonical = await read("agent_list")
      const { userNotes, sessionFields, connectionCount, ...legacyRow } = legacy.agents[0]
      expect(legacyRow).toMatchObject({
        id: caller.id,
        pid: null,
        attached: false,
        busy: false,
        lastMessageAt: null,
        lastSeenAt: null,
        turnState: "idle",
        displayName: expect.any(String),
      })
      expect([userNotes, sessionFields, connectionCount]).toEqual(["", {}, 3])
      expect(canonical).toEqual({
        agents: [{ ...legacyRow, agentNotes: "", agentFields: {}, viewerCount: 3 }],
      })
      const fields = ["title", "unavailable"]
      expect(await read("session_state", { agent: caller.id, fields })).toEqual({
        agent: caller.id,
        title: "",
      })
      expect(await read("agent_state", { agentId: caller.id, fields })).toEqual({
        agentId: caller.id,
        title: "",
      })
      const defaultState = await read("agent_state", { agentId: caller.id })
      expect(defaultState).not.toHaveProperty("commands")
      expect(await read("agent_state", { agentId: caller.id, fields: [] })).toEqual(defaultState)
      expect(
        await read("agent_state", { agentId: caller.id, fields: ["title", "*"] }),
      ).toHaveProperty("commands")
      expect(await read("agent_whoami")).toMatchObject({
        agentId: caller.id,
        agentNotes: "",
        agentFields: {},
        sessionId: `sess-${caller.id}`,
        runtime: { memory: null, source: "unavailable" },
      })
      expect(await read("session_whoami")).toMatchObject({
        agent: caller.id,
        userNotes: "",
        sessionFields: {},
      })
    } finally {
      await client.close()
    }
  })

  it("validates send before effects and ignores a simultaneous legacy target", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const target = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-send" })
    const other = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-other" })
    await agentSessionRegistry.getOrCreateHost(target.id)
    const host = agentSessionRegistry.hosts.get(target.id)
    if (!host) throw new Error("expected target host")
    vi.mocked(agentSessionRegistry.getOrCreateHost).mockClear()
    const client = await connectClient(app)
    try {
      for (const args of [
        { agent: target.id, prompt: "invalid" },
        { agentId: target.id, prompt: 1 },
      ]) {
        const invalid = await client.callTool({ name: "agent_send", arguments: args })
        expect(invalid.isError).toBe(true)
        expect(invalid._meta).toBeUndefined()
      }
      expect(agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()

      const sent = await client.callTool({
        name: "agent_send",
        arguments: {
          agentId: target.id,
          agent: other.id,
          prompt: "hi",
          sets: { model: "fast", persona: "review" },
        },
      })
      expect(sent.isError).toBeUndefined()
      expect(JSON.parse(toolText(sent))).toMatchObject({ stopReason: "end_turn", text: "echo:hi" })
      expect(host.setConfigOption.mock.calls).toEqual([
        ["model", "fast"],
        ["persona", "review"],
      ])
      expect(host.setConfigOption).toHaveBeenCalledBefore(host.prompt)
      expect(host.prompt).toHaveBeenCalledExactlyOnceWith(`sess-${target.id}`, "hi")
      expect(agentSessionRegistry.getOrCreateHost).toHaveBeenCalledExactlyOnceWith(target.id)
    } finally {
      await client.close()
    }
  })

  it.each(["session_send", "agent_send"])(
    "keeps failure classes and prevents config/prompt in %s",
    async (name) => {
      const { app, registry, orchestrator, agentSessionRegistry } = makeApp()
      const row = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-send-error" })
      await agentSessionRegistry.getOrCreateHost(row.id)
      const host = agentSessionRegistry.hosts.get(row.id)
      if (!host) throw new Error("expected row host")
      const get = vi.mocked(agentSessionRegistry.getOrCreateHost)
      const client = await connectClient(app)
      const canonical = name === "agent_send"
      const call = (id: string) =>
        client.callTool({
          name,
          arguments: {
            [canonical ? "agentId" : "agent"]: id,
            prompt: "hi",
            sets: { model: "fast" },
          },
        })
      try {
        get.mockClear()
        const missing = await call("missing")
        expect(toolText(missing)).toBe("agent not found")
        expect(missing._meta?.["drive-coding/errorCode"]).toBe(
          canonical ? "agent_not_found" : undefined,
        )
        expect(get).not.toHaveBeenCalled()
        for (const reason of ["not-found", "conn-dead"] as const) {
          get.mockResolvedValueOnce({ ok: false, reason })
          const unavailable = await call(row.id)
          expect(toolText(unavailable)).toBe(`session host did not start: ${reason}`)
          expect(unavailable._meta?.["drive-coding/errorCode"]).toBe(
            canonical ? "agent_host_unavailable" : undefined,
          )
        }
        get.mockRejectedValueOnce(new Error("session host did not start: not-found"))
        const rejection = await call(row.id)
        expect(rejection.isError).toBe(true)
        expect(toolText(rejection)).toBe("session host did not start: not-found")
        expect(rejection._meta).toBeUndefined()
        host.state.sessionId = null
        const inactive = await call(row.id)
        expect(toolText(inactive)).toBe("no sessionId — run session_open first")
        expect(inactive._meta?.["drive-coding/errorCode"]).toBe(
          canonical ? "no_active_acp_session" : undefined,
        )
        expect(host.setConfigOption).not.toHaveBeenCalled()
        expect(host.prompt).not.toHaveBeenCalled()
        expect(orchestrator.deleteAndKill).not.toHaveBeenCalled()
      } finally {
        await client.close()
      }
    },
  )

  it("keeps field deletion on the registered caller and distinguishes a disappearing row", async () => {
    const { app, registry } = makeApp()
    const row = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-memory" })
    const update = vi.spyOn(registry, "update")
    const call = async (headers?: Record<string, string>) => {
      const client = await connectClient(app, headers)
      try {
        return await client.callTool({ name: "agent_field_delete", arguments: { key: "missing" } })
      } finally {
        await client.close()
      }
    }
    for (const headers of [
      undefined,
      { [AGENT_ID_HEADER]: "00000000-0000-4000-8000-000000000001" },
    ]) {
      const unknown = await call(headers)
      expect(unknown.isError).toBe(true)
      expect(toolText(unknown)).toContain(AGENT_ID_HEADER)
      expect(unknown._meta).toBeUndefined()
    }
    const headers = { [AGENT_ID_HEADER]: row.id }
    const noop = await call(headers)
    expect(JSON.parse(toolText(noop))).toEqual({ ok: true })
    const lookup = vi.spyOn(registry, "get")
    const identified = await connectClient(app, headers)
    try {
      lookup.mockResolvedValueOnce(row).mockResolvedValueOnce(null)
      const deleted = await identified.callTool({
        name: "agent_field_delete",
        arguments: { key: "missing" },
      })
      expect(deleted.isError).toBe(true)
      expect(deleted._meta?.["drive-coding/errorCode"]).toBe("agent_not_found")
      expect(toolText(deleted)).toBe("agent not found")
      expect(update).not.toHaveBeenCalled()
    } finally {
      await identified.close()
    }
  })
})

describe("C1 identity, event bus and turn boundaries", () => {
  it("serves the recommendation in raw initialize and the guide", async () => {
    const { app } = makeApp()
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          clientInfo: { name: "workflow-probe", version: "1.0.0" },
          capabilities: {},
        },
      }),
    })
    expect(response.status).toBe(200)
    const { result } = await response.json()
    expect(result.serverInfo.version).toBe(resolveAppVersion())
    expect(result.instructions).toMatch(/\*\*session_open\*\*.*`cli`.*`cwd`/)
    expect(result.instructions).toContain("session_send.sets")
    const client = await connectClient(app)
    try {
      const guide = await client.readResource({ uri: "drive-coding://guide" })
      expect(guide.contents[0]).toMatchObject({ text: result.instructions })
    } finally {
      await client.close()
    }
  })

  it("uses one subscription across names and updates the option on that subscription", async () => {
    const { app, registry, eventBus } = makeApp()
    const caller = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-subscriber" })
    const target = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-watched" })
    const subscribe = vi.spyOn(eventBus, "subscribe")
    const client = await connectClient(app, { [AGENT_ID_HEADER]: caller.id })
    try {
      const absent = await client.callTool({
        name: "agent_subscribe",
        arguments: { agentId: "missing" },
      })
      expect(absent.isError).toBe(true)
      expect(absent._meta?.["drive-coding/errorCode"]).toBe("agent_not_found")
      expect(subscribe).not.toHaveBeenCalled()
      const legacy = await client.callTool({
        name: "session_subscribe",
        arguments: { agent: target.id },
      })
      expect(JSON.parse(toolText(legacy))).toEqual({
        ok: true,
        agent: target.id,
        subscriber: caller.id,
      })
      for (const includeLastAssistantText of [false, true]) {
        const canonical = await client.callTool({
          name: "agent_subscribe",
          arguments: { agentId: target.id, includeLastAssistantText },
        })
        expect(JSON.parse(toolText(canonical))).toEqual({
          ok: true,
          agentId: target.id,
          subscriberAgentId: caller.id,
        })
        expect(eventBus.subscribersOf(target.id)).toEqual([caller.id])
        expect(eventBus.optionsOf(target.id, caller.id)?.includeLastAssistantText).toBe(
          includeLastAssistantText,
        )
      }
      expect(subscribe.mock.calls).toEqual([
        [target.id, caller.id, { includeLastAssistantText: false }],
        [target.id, caller.id, { includeLastAssistantText: false }],
        [target.id, caller.id, { includeLastAssistantText: true }],
      ])
    } finally {
      await client.close()
    }
  })

  it("edits the caller's memory through canonical and legacy names", async () => {
    const { app, registry } = makeApp()
    const caller = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-caller-memory" })
    const other = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-other-memory" })
    const update = vi.spyOn(registry, "update")
    const client = await connectClient(app, { [AGENT_ID_HEADER]: caller.id })
    try {
      const actions = [
        ["agent_note_set", { text: "note", agentId: other.id }],
        ["session_field_set", { key: "keep", value: "legacy" }],
        ["agent_field_set", { key: " report ", value: "first\nsecond", agentId: other.id }],
        ["agent_field_delete", { key: " report " }],
        ["session_note_set", { text: "" }],
      ] as const
      for (const [name, args] of actions) {
        const result = await client.callTool({ name, arguments: args })
        expect(JSON.parse(toolText(result))).toEqual({ ok: true })
      }
      const invalid = await client.callTool({
        name: "agent_field_set",
        arguments: { key: " ", value: "invalid" },
      })
      expect(invalid.isError).toBe(true)
      expect(invalid._meta).toBeUndefined()
      expect(update.mock.calls).toEqual([
        [caller.id, { userNotes: "note" }],
        [caller.id, { sessionFields: { keep: "legacy" } }],
        [caller.id, { sessionFields: { keep: "legacy", report: "first\nsecond" } }],
        [caller.id, { sessionFields: { keep: "legacy" } }],
        [caller.id, { userNotes: "" }],
      ])
      expect((await registry.get(other.id))?.userNotes).toBeUndefined()
    } finally {
      await client.close()
    }
  })

  it("keeps the canonical send alive through timeout and projects unavailable state", async () => {
    const { app, registry, agentSessionRegistry } = makeApp()
    const agent = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-timeout" })
    const client = await connectClient(app)
    try {
      for (const [id, code] of [
        ["missing", "agent_not_found"],
        [agent.id, "agent_host_unavailable"],
      ]) {
        const state = await client.callTool({ name: "agent_state", arguments: { agentId: id } })
        expect(state.isError).toBe(true)
        expect(state._meta?.["drive-coding/errorCode"]).toBe(code)
      }
      expect(agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()
      await agentSessionRegistry.getOrCreateHost(agent.id)
      const host = agentSessionRegistry.hosts.get(agent.id)
      if (!host) throw new Error("expected target host")
      let finishTurn = () => {}
      const turn = new Promise<void>((resolve) => {
        finishTurn = resolve
      })
      host.prompt.mockImplementationOnce(() => turn)
      try {
        const sent = await client.callTool({
          name: "agent_send",
          arguments: { agentId: agent.id, timeoutSec: 0.01, prompt: "continue" },
        })
        expect(JSON.parse(toolText(sent))).toEqual({ running: true })
        expect(host.prompt).toHaveBeenCalledExactlyOnceWith(`sess-${agent.id}`, "continue")
      } finally {
        finishTurn()
      }
    } finally {
      await client.close()
    }
  })
})

it.each(["session_open", "agent_open"])(
  "%s leaves spawn failures before an allocated ID in the existing error layer",
  async (name) => {
    const { app, orchestrator, agentSessionRegistry } = makeApp()
    vi.mocked(orchestrator.createAndSpawn).mockRejectedValueOnce(new Error("fixture spawn failed"))
    const client = await connectClient(app)
    try {
      const result = await client.callTool({
        name,
        arguments: {
          [name === "agent_open" ? "cliKind" : "cli"]: "cursor",
          cwd: "/tmp/mcp-spawn-failure",
        },
      })
      expect(result.isError).toBe(true)
      expect(result._meta).toBeUndefined()
      expect(toolText(result)).toBe("fixture spawn failed")
      expect(orchestrator.createAndSpawn).toHaveBeenCalledOnce()
      expect(orchestrator.deleteAndKill).not.toHaveBeenCalled()
      expect(agentSessionRegistry.getOrCreateHost).not.toHaveBeenCalled()
    } finally {
      await client.close()
    }
  },
)

it("keeps scope denial ahead of canonical close even with force", async () => {
  const { app, registry, orchestrator, agentSessionRegistry } = makeApp()
  const caller = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-close-caller" })
  const target = await registry.create({ cliKind: "cursor", cwd: "/tmp/mcp-close-target" })
  const client = await connectClient(app, { [SCOPE_HEADER]: issueToken(caller.id) })
  setScopePolicyOverride({ close: "deny" })
  try {
    for (const [name, idKey] of [
      ["session_close", "agent"],
      ["agent_close", "agentId"],
    ] as const) {
      const result = await client.callTool({ name, arguments: { [idKey]: target.id, force: true } })
      expect(result.isError).toBe(true)
      expect(result._meta).toBeUndefined()
      expect(JSON.parse(toolText(result))).toMatchObject({ error: "scope-denied" })
    }
    expect(orchestrator.deleteAndKill).not.toHaveBeenCalled()
    expect(agentSessionRegistry.getHost).not.toHaveBeenCalled()
    expect(await registry.get(target.id)).not.toBeNull()
  } finally {
    resetScopePolicyForTests()
    await client.close()
  }
})
