/**
 * agent-prompt-sources.test.ts — HTTP, MCP, and orchestrator must emit the same surface text.
 */

import type { Agent, AgentRegistry, CreateAgentInput } from "@drive-coding/core"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
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

async function readMcpSurfaces(agent: Agent): Promise<string[]> {
  type Handler = (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>
  const handlers = new Map<string, Handler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer
  registerSessionSurfaceMcpTool(server, { urlConfig }, { callerAgentId: agent.id }, agent)
  expect([...handlers.keys()].sort()).toEqual(["agent_surface", "session_surface"])
  return Promise.all(
    ["session_surface", "agent_surface"].map(async (name) => {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`${name} handler not registered`)
      const result = await handler({})
      return result.content[0]?.text ?? ""
    }),
  )
}

function expectWorkflow(prompt: string): void {
  expect(prompt).toContain("tools/list")
  expect(prompt).toContain("agent_*")
  expect(prompt).toMatch(/call \*\*session_open\*\* with `cli` and absolute `cwd`/)
  expect(prompt).toContain(
    "`agent` UUID for **session_state**, **session_send** and **session_close**",
  )
  expect(prompt).toContain("session_send.sets")
  expect(prompt).toContain("session_whoami")
  expect(prompt).toContain("session_note_set")
}

describe("surface prompt — three delivery paths", () => {
  it("HTTP, MCP compose, and orchestrator connect opts share one text (assignment once)", async () => {
    const agent = sampleAgent({
      userNotes: `  ${"note line\n".repeat(1_800)}  `,
      sessionFields: { report: "first line\nsecond line", status: "ready" },
      systemPrompt: `  ${charter}  `,
    })
    const direct = buildAgentPromptText(promptOptsFromAgent(agent), urlConfig)

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
      getRuntimeInfo: vi.fn(() => null),
      getLastSeenAt: vi.fn(() => null),
      listHttpConnectionIds: vi.fn(() => []),
      listViewerRows: vi.fn(() => []),
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
          parentAgentId: input.parentAgentId,
          userNotes: agent.userNotes,
          sessionFields: agent.sessionFields,
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
      systemPrompt: agent.systemPrompt,
      parentAgentId: agent.parentAgentId,
    })

    const app = new Hono()
    registerAgentPromptHttp(app, { registry: spawnRegistry, urlConfig })
    const readHttp = async () => [
      await (await app.request(`/api/agent-prompt?agent=${agent.id}`)).text(),
      await (
        await app.request("/api/agent-prompt", { headers: { "X-Drive-Coding-Agent": agent.id } })
      ).text(),
    ]
    const prompts = [
      ...(await readHttp()),
      ...(await readMcpSurfaces(agent)),
      connectAgentPrompt ?? "",
    ]
    for (const prompt of prompts) {
      expect(prompt).toBe(direct)
      expectWorkflow(prompt)
      expect(prompt.length).toBeGreaterThan(14_000)
      expect(prompt).toContain(agent.id)
      expect(prompt).toContain("parent-uuid")
      expect(prompt).toContain(agent.userNotes)
      expect(prompt).toContain("- **report**: first line\nsecond line")
      expect(prompt.indexOf("# Agent memory")).toBeLessThan(prompt.indexOf("# Your assignment"))
      expect(prompt.match(/# Your assignment/g)?.length).toBe(1)
      expect(prompt.endsWith(charter)).toBe(true)
    }

    const edited = await spawnRegistry.update(agent.id, {
      userNotes: "new note",
      sessionFields: { report: "updated\nreport" },
    })
    const refreshed = buildAgentPromptText(promptOptsFromAgent(edited), urlConfig)
    for (const prompt of [...(await readHttp()), ...(await readMcpSurfaces(edited))]) {
      expect(prompt).toBe(refreshed)
      expect(prompt).toContain("new note")
      expect(prompt).toContain("updated\nreport")
      expectWorkflow(prompt)
    }
    expect(connectAgentPrompt).toBe(direct)
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
      getRuntimeInfo: vi.fn(() => null),
      getLastSeenAt: vi.fn(() => null),
      listHttpConnectionIds: vi.fn(() => []),
      listViewerRows: vi.fn(() => []),
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
