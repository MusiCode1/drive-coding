/**
 * http-mcp.ts — POST/GET/DELETE /api/mcp (slice session-bus-mcp C0).
 *
 * Stateless Streamable HTTP: a new WebStandardStreamableHTTPServerTransport
 * AND a new McpServer are created inside the handler for every request.
 * A singleton transport throws on the second request (SDK, measured).
 *
 * Tools call orchestrator / agentSessionRegistry in-process. No HTTP self-call.
 *
 * Tool inputSchema is derived from ArkType via toJsonSchema (session-bus.ts).
 * The SDK checks Zod input before the handler validates with ArkType.
 *
 * Kill switch: MCP_HTTP=0 skips registration (default ON).
 */
import {
  type AgentRegistry,
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_INSTRUCTIONS,
  MCP_SERVER_TITLE,
  McpAgentStateInput,
  McpSessionListInput,
  SessionStateMcpInput,
  toAgentPublic,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { Hono } from "hono"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { resolveAppVersion } from "../app-version.js"
import { readScopeToken, stripScopePendingFromState } from "../scope-write.js"
import type { AgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { registerAgentEventMcpTools } from "./agent-events-mcp-tools.js"
import { registerAgentDocsMcp } from "./docs-mcp.js"
import { senderFromRecord } from "./drive-message-source.js"
import { cliMeta, registerMcpOpenTool } from "./mcp-open-tool.js"
import { McpToolError, registerArkTool, registerToolPair } from "./mcp-tool-alias.js"
import { registerMcpWriteTools } from "./mcp-write-tools.js"
import type { UrlConfig } from "./public-url.js"
import { registerSessionMemoryMcpTools } from "./session-memory-mcp-tools.js"
import { registerSessionSurfaceMcpTool } from "./session-surface-mcp-tool.js"
import { registerSessionWhoamiMcpTool } from "./session-whoami-mcp-tool.js"

const log = createLogger("backend.mcp")

/** /state is ~47KB, 88% commands. Default session_state omits that blob. */
const DEFAULT_STATE_FIELDS = [
  "sessionId",
  "turnState",
  "title",
  "status",
  "modes",
  "configOptions",
  "lastTurnError",
  "pending",
] as const

export type McpHttpDeps = {
  registry: AgentRegistry
  orchestrator: AgentOrchestrator
  agentSessionRegistry: AgentSessionRegistry
  env: NodeJS.ProcessEnv
  urlConfig: UrlConfig
  eventBus?: AgentEventBus
  memoryGuard?: import("./memory-guard.js").MemoryGuard
  /** Test knob when server has not listened (app.request without bind). */
  selfBaseUrl?: string
}

/** Per-request caller resolved from AGENT_ID_HEADER (unknown ids → anonymous). */
export type McpRequestContext = {
  callerAgentId?: string
  scopeToken?: string
}

function pickSessionState(
  state: Record<string, unknown>,
  fields: string[] | undefined,
): Record<string, unknown> {
  if (fields?.includes("*")) return stripScopePendingFromState({ ...state })
  const keys = fields && fields.length > 0 ? fields : DEFAULT_STATE_FIELDS
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (Object.hasOwn(state, k)) out[k] = state[k]
  }
  return stripScopePendingFromState(out)
}

function createSessionBusMcpServer(
  deps: McpHttpDeps,
  ctx: McpRequestContext,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
): McpServer {
  const server = new McpServer(
    {
      name: "drive-coding",
      title: MCP_SERVER_TITLE,
      description: MCP_SERVER_DESCRIPTION,
      version: resolveAppVersion(),
    },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  )

  registerAgentDocsMcp(server, registerArkTool)

  server.registerResource(
    "guide",
    "drive-coding://guide",
    {
      title: "Usage guide",
      description: "Workflow, identity header, and limits for drive-coding MCP tools.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "drive-coding://guide",
          mimeType: "text/markdown",
          text: MCP_SERVER_INSTRUCTIONS,
        },
      ],
    }),
  )

  const callerAgentId = ctx.callerAgentId
  const scopeToken = ctx.scopeToken
  const scopeDeps = { registry: deps.registry, sessionRegistry: deps.agentSessionRegistry }

  registerToolPair(
    server,
    "session_list",
    McpSessionListInput,
    async () => {
      const all = await deps.registry.list()
      const agents = all.map((a) => {
        const rt = deps.agentSessionRegistry.getRuntimeInfo(a.id)
        const host = deps.agentSessionRegistry.getHost(a.id)
        return {
          ...toAgentPublic(a),
          displayName: cliMeta(a.cliKind, deps.env).displayName,
          pid: rt?.pid ?? null,
          attached: rt?.attached ?? false,
          busy: rt?.busy ?? false,
          lastMessageAt: rt?.lastMessageAt ?? null,
          lastSeenAt: rt?.lastSeenAt ?? null,
          attachedVia: rt?.via,
          connectionCount: deps.agentSessionRegistry.getConnectionCount(a.id),
          turnState: host?.state.turnState,
        }
      })
      return { agents }
    },
    {
      project: ({ agents }) => ({
        agents: agents.map(({ userNotes, sessionFields, connectionCount, ...agent }) => ({
          ...agent,
          agentNotes: userNotes,
          agentFields: sessionFields,
          viewerCount: connectionCount,
        })),
      }),
    },
  )

  registerMcpOpenTool(server, deps, ctx)

  const callerSender = callerAgentId && callerRecord ? senderFromRecord(callerRecord) : undefined
  registerMcpWriteTools(server, deps, scopeToken, scopeDeps, callerSender)

  registerToolPair(
    server,
    "session_state",
    SessionStateMcpInput,
    async (input) => {
      const existing = await deps.registry.get(input.agent)
      if (!existing) throw new McpToolError("agent not found", "agent_not_found")
      const host = deps.agentSessionRegistry.getHost(input.agent)
      if (!host) throw new McpToolError("agent connection not found", "agent_host_unavailable")
      return {
        agent: input.agent,
        ...pickSessionState(host.state as unknown as Record<string, unknown>, input.fields),
      }
    },
    {
      input: {
        schema: McpAgentStateInput,
        normalize: ({ agentId, fields }) => ({ agent: agentId, fields }),
      },
      project: ({ agent, ...state }) => ({ agentId: agent, ...state }),
    },
  )
  registerSessionMemoryMcpTools(server, deps, ctx, callerRecord)
  registerSessionWhoamiMcpTool(server, deps, ctx, callerRecord)
  registerSessionSurfaceMcpTool(server, deps, ctx, callerRecord)
  if (deps.eventBus) {
    registerAgentEventMcpTools(
      server,
      {
        registry: deps.registry,
        agentSessionRegistry: deps.agentSessionRegistry,
        eventBus: deps.eventBus,
      },
      ctx,
      callerRecord,
    )
  }
  return server
}

/**
 * registerMcpHttp — mounts Streamable HTTP MCP at /api/mcp.
 * Transport + McpServer are built per request (stateless). Do not hoist them.
 */
export function registerMcpHttp(app: Hono, deps: McpHttpDeps): void {
  if (deps.env.MCP_HTTP === "0") {
    log.info({}, "MCP HTTP endpoint disabled (MCP_HTTP=0)")
    return
  }

  app.on(["POST", "GET", "DELETE"], "/api/mcp", async (c) => {
    const rawCaller = c.req.header(AGENT_ID_HEADER)?.trim()
    let callerAgentId: string | undefined
    let callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>
    if (rawCaller) {
      callerRecord = await deps.registry.get(rawCaller)
      if (callerRecord) callerAgentId = rawCaller
      else callerRecord = null
    } else {
      callerRecord = null
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const scopeToken = readScopeToken((name) => c.req.header(name))
    const server = createSessionBusMcpServer(deps, { callerAgentId, scopeToken }, callerRecord)
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      await transport.close()
      await server.close()
    }
  })
}
