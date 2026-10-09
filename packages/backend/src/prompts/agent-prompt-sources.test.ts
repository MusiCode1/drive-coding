/**
 * agent-prompt-sources.test.ts — HTTP, MCP, and orchestrator must emit the same surface text.
 */

import type { Agent, AgentRegistry, CreateAgentInput } from "@drive-coding/core"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { createAgentOrchestrator } from "../app/agent-orchestrator.js"
import { registerAgentPromptHttp } from "../delivery/http-agent-prompt.js"
import { registerSessionSurfaceMcpTool } from "../delivery/session-surface-mcp-tool.js"
import { buildAgentPromptText } from "./index.js"

const urlConfig = { port: 4371, host: "127.0.0.1", publicBaseUrl: "https://public.example.com" }

const charter = "You are the verifier. Do not edit code."

function sampleAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    cliKind: "codex",
    cwd: "/tmp/work",
    modelOverride: null,
    status: "ready",
    createdAt: new Date().toISOString(),
    systemPrompt: charter,
    parentAgentId: "parent-uuid",
    ...overrides,
  } as Agent
}

function promptOptsFromAgent(agent: Agent) {
  return {
    agentId: agent.id,
    parentAgentId: agent.parentAgentId,
    charter: agent.systemPrompt ?? undefined,
    userNotes: agent.userNotes,
    sessionFields: agent.sessionFields,
  }
}

async function invokeSessionSurfaceMcp(agent: Agent): Promise<string> {
  let handler:
    | ((parsed: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>)
    | undefined
  const registerArkTool = vi.fn(
    (
      _server: McpServer,
      _name: string,
      _meta: { title: string; description: string },
      _ark: { toJsonSchema: () => object; (data: unknown): unknown },
      h: (parsed: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
    ) => {
      handler = h
    },
  )
  registerSessionSurfaceMcpTool(
    {} as McpServer,
    { urlConfig },
    { callerAgentId: agent.id },
    agent,
    registerArkTool,
  )
  if (handler === undefined) throw new Error("session_surface handler not registered")
  const result = await handler({})
  return result.content[0]?.text ?? ""
}

describe("surface prompt — three delivery paths", () => {
  it("HTTP, MCP compose, and orchestrator connect opts share one text (assignment once)", async () => {
    const agent = sampleAgent()

    const direct = buildAgentPromptText(promptOptsFromAgent(agent), urlConfig)

    const registry: AgentRegistry = {
      get: vi.fn(async (id: string) => (id === agent.id ? agent : null)),
      list: vi.fn(async () => [agent]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }

    const app = new Hono()
    registerAgentPromptHttp(app, { registry, urlConfig })
    const httpBody = await (await app.request(`/api/agent-prompt?agent=${agent.id}`)).text()

    const mcpBody = await invokeSessionSurfaceMcp(agent)

    let connectAgentPrompt: string | undefined
    const connectionRegistry: ConnectionRegistry = {
      connect: vi.fn(async (_id, _kind, opts) => {
        connectAgentPrompt = opts.agentPrompt ?? undefined
        return {
          wire: { onLine: () => () => {}, write: () => true },
          capabilities: {
            mcp: false,
            compact: false,
            commands: false,
            usage: false,
            image: false,
            thinkingTokens: false,
            rename: false,
            supportsModelFlag: false,
            supportsSessionResume: false,
            supportsConfigOptions: false,
          },
          onFrame: () => () => {},
          turn: { isBusy: () => false, lastActivityAt: () => null, onChange: () => () => {} },
          onCrash: () => () => {},
          close: async () => {},
          ext: undefined,
          pid: null,
        } as unknown as ProviderConnection
      }),
      get: vi.fn(),
      getCwd: vi.fn(),
      getCharter: vi.fn(),
      consumeCharter: vi.fn(),
      getCliKind: vi.fn(),
      list: vi.fn(() => []),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      touchConnection: vi.fn(),
      clearAllConnections: vi.fn(),
      getConnectionCount: vi.fn(() => 0),
      isAttached: vi.fn(() => false),
      getEpoch: vi.fn(() => 0),
      isOwnedByWs: vi.fn(() => false),
      getRuntimeInfo: vi.fn(() => null),
      getLastSeenAt: vi.fn(() => null),
      listHttpConnectionIds: vi.fn(() => []),
      setWsSocketChecker: vi.fn(),
      close: vi.fn(),
      onCrash: vi.fn(() => () => {}),
    }

    const state = new Map<string, Agent>()
    const spawnRegistry: AgentRegistry = {
      async create(input: CreateAgentInput) {
        const row = sampleAgent({
          cliKind: input.cliKind,
          cwd: input.cwd,
          systemPrompt: input.systemPrompt ?? null,
        })
        state.set(row.id, row)
        return row
      },
      async get(id: string) {
        return state.get(id) ?? null
      },
      async list() {
        return [...state.values()]
      },
      async update(id, patch) {
        const cur = state.get(id)
        if (!cur) throw new Error("missing")
        const next = { ...cur, ...patch }
        state.set(id, next)
        return next
      },
      async delete(id: string) {
        state.delete(id)
      },
    }

    const orch = createAgentOrchestrator({
      registry: spawnRegistry,
      connectionRegistry,
      urlConfig,
    })
    await orch.createAndSpawn({
      cliKind: "codex",
      cwd: agent.cwd,
      modelOverride: null,
      systemPrompt: charter,
    })

    expect(httpBody).toBe(direct)
    expect(mcpBody).toBe(direct)
    expect(connectAgentPrompt).toBe(direct)
    expect(direct).toContain(agent.id)
    expect(direct).toContain("# Your assignment")
    expect(direct.match(/# Your assignment/g)?.length).toBe(1)
    expect(direct).toContain(charter)
  })
})

describe("createAndSpawn → connect agentPrompt chain", () => {
  it("passes non-empty agentPrompt containing /api/fs/file to connectionRegistry.connect", async () => {
    let connectOpts: ConnectOpts | undefined
    const connectionRegistry: ConnectionRegistry = {
      connect: vi.fn(async (_id, _kind, opts) => {
        connectOpts = opts
        return {
          wire: { onLine: () => () => {}, write: () => true },
          capabilities: {},
          onFrame: () => () => {},
          turn: { isBusy: () => false, lastActivityAt: () => null, onChange: () => () => {} },
          onCrash: () => () => {},
          close: async () => {},
          ext: undefined,
          pid: null,
        } as unknown as ProviderConnection
      }),
      get: vi.fn(),
      getCwd: vi.fn(),
      getCharter: vi.fn(),
      consumeCharter: vi.fn(),
      getCliKind: vi.fn(),
      list: vi.fn(() => []),
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      touchConnection: vi.fn(),
      clearAllConnections: vi.fn(),
      getConnectionCount: vi.fn(() => 0),
      isAttached: vi.fn(() => false),
      getEpoch: vi.fn(() => 0),
      isOwnedByWs: vi.fn(() => false),
      getRuntimeInfo: vi.fn(() => null),
      getLastSeenAt: vi.fn(() => null),
      listHttpConnectionIds: vi.fn(() => []),
      setWsSocketChecker: vi.fn(),
      close: vi.fn(),
      onCrash: vi.fn(() => () => {}),
    }

    const state = new Map<string, Agent>()
    const registry: AgentRegistry = {
      async create(input: CreateAgentInput) {
        const row = sampleAgent({ cliKind: input.cliKind, cwd: input.cwd })
        state.set(row.id, row)
        return row
      },
      async get(id: string) {
        return state.get(id) ?? null
      },
      async list() {
        return [...state.values()]
      },
      async update(id, patch) {
        const cur = state.get(id)
        if (!cur) throw new Error("missing")
        const next = { ...cur, ...patch }
        state.set(id, next)
        return next
      },
      async delete(id: string) {
        state.delete(id)
      },
    }

    const orch = createAgentOrchestrator({
      registry,
      connectionRegistry,
      urlConfig: { port: 4372, host: "127.0.0.1" },
    })
    await orch.createAndSpawn({
      cliKind: "codex",
      cwd: "/tmp/codex-spawn-chain",
      modelOverride: null,
    })

    expect(connectOpts?.agentPrompt).toBeDefined()
    expect(connectOpts?.agentPrompt?.length).toBeGreaterThan(200)
    expect(connectOpts?.agentPrompt).toContain("/api/fs/file")
  })
})
