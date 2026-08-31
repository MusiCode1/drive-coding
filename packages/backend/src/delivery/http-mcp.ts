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
 * Handlers re-validate with the same ArkType types — Zod is advertisement only.
 *
 * Kill switch: MCP_HTTP=0 skips registration (default ON).
 */

import {
  AgentNotifyParentInput,
  AgentOpenInput,
  type AgentRegistry,
  MCP_CONFIGURE_HINT,
  MCP_NOTIFY_PARENT_META,
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_INSTRUCTIONS,
  MCP_SERVER_TITLE,
  MCP_TOOL_META,
  McpSessionListInput,
  SessionStateMcpInput,
  toAgentPublic,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { getCliSpec } from "@drive-coding/provider/config"
import { type } from "arktype"
import type { Hono } from "hono"
import { z } from "zod"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { readScopeToken } from "../scope-write.js"
import { registerMcpWriteTools } from "./mcp-write-tools.js"
import { resolveAppVersion } from "../app-version.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { parseCreateAgentBody } from "./create-agent-input.js"

const log = createLogger("backend.mcp")

/** Same 30s cap as dispatch-via-api open / agent-cli open. */
const SESSION_OPEN_TIMEOUT_MS = 30_000
const SESSION_OPEN_POLL_MS = 1_500

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
  /** Test knob when server has not listened (app.request without bind). */
  selfBaseUrl?: string
}

/** Per-request caller resolved from AGENT_ID_HEADER (unknown ids → anonymous). */
export type McpRequestContext = {
  callerAgentId?: string
  scopeToken?: string
}

/** ArkType type that can both validate and emit JSON Schema. */
type ArkObject = {
  toJsonSchema: () => object
  (data: unknown): unknown
}

function inputSchemaFromArk(ark: ArkObject): z.ZodType {
  const full = ark.toJsonSchema() as Record<string, unknown>
  const { $schema: _schema, ...rest } = full
  return z.fromJSONSchema(rest)
}

function jsonResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>
} {
  return { content: [{ type: "text", text: JSON.stringify(value) }] }
}

function jsonError(message: string): {
  isError: true
  content: Array<{ type: "text"; text: string }>
} {
  return { isError: true, content: [{ type: "text", text: message }] }
}

type ToolResult = ReturnType<typeof jsonResult> | ReturnType<typeof jsonError>

function registerArkTool(
  server: McpServer,
  name: string,
  meta: { title: string; description: string },
  ark: ArkObject,
  handler: (parsed: unknown) => Promise<ToolResult>,
): void {
  server.registerTool(name, { ...meta, inputSchema: inputSchemaFromArk(ark) }, async (args) => {
    const parsed = ark(args ?? {})
    if (parsed instanceof type.errors) return jsonError(parsed.summary)
    try {
      return await handler(parsed)
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : String(e))
    }
  })
}

function defaultPublicUrl(): string {
  const port = process.env.PORT ?? "4000"
  const host = process.env.DRIVE_CODING_HOST ?? "127.0.0.1"
  return `http://${host}:${port}`
}

async function waitForSessionId(
  registry: AgentSessionRegistry,
  agentId: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const sid = registry.getHost(agentId)?.state.sessionId
    if (typeof sid === "string" && sid.length > 0) return sid
    if (Date.now() >= deadline) return undefined
    await new Promise((r) => setTimeout(r, SESSION_OPEN_POLL_MS))
  }
}

function pickSessionState(
  state: Record<string, unknown>,
  fields: string[] | undefined,
): Record<string, unknown> {
  if (fields?.includes("*")) return { ...state }
  const keys = fields && fields.length > 0 ? fields : DEFAULT_STATE_FIELDS
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (Object.hasOwn(state, k)) out[k] = state[k]
  }
  return out
}

function cliMeta(kind: string): { kind: string; displayName: string } {
  const spec = getCliSpec(kind, process.env)
  return { kind, displayName: spec?.displayName ?? kind }
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

  registerArkTool(
    server,
    "session_list",
    MCP_TOOL_META.session_list,
    McpSessionListInput,
    async () => {
      const all = await deps.registry.list()
      const agents = all.map((a) => {
        const rt = deps.agentSessionRegistry.getRuntimeInfo(a.id)
        const host = deps.agentSessionRegistry.getHost(a.id)
        return {
          ...toAgentPublic(a),
          displayName: cliMeta(a.cliKind).displayName,
          pid: rt?.pid ?? null,
          attached: rt?.attached ?? false,
          busy: rt?.busy ?? false,
          lastMessageAt: rt?.lastMessageAt ?? null,
          lastSeenAt: rt?.lastSeenAt ?? null,
          attachedVia: rt?.via,
          turnState: host?.state.turnState,
        }
      })
      return jsonResult({ agents })
    },
  )

  registerArkTool(
    server,
    "session_open",
    MCP_TOOL_META.session_open,
    AgentOpenInput,
    async (raw) => {
      const input = raw as typeof AgentOpenInput.infer
      const publicUrl = (input.publicUrl ?? input.base ?? defaultPublicUrl()).replace(/\/$/, "")
      const env: Record<string, string> = { ...(input.env ?? {}) }
      env.DRIVE_CODING_BASE = publicUrl
      env.DC_BASE = publicUrl

      const headerParent = callerAgentId
      const explicitParent =
        input.parent !== undefined && input.parent !== "" ? input.parent : undefined

      if (headerParent && explicitParent && explicitParent !== headerParent) {
        return jsonError(
          `${AGENT_ID_HEADER} (${headerParent}) conflicts with explicit parent (${explicitParent})`,
        )
      }

      const effectiveParent = headerParent ?? explicitParent
      if (effectiveParent !== undefined) env.DC_PARENT = effectiveParent

      const body: Record<string, unknown> = {
        cliKind: input.cli,
        cwd: input.cwd,
        env,
      }
      if (input.permission !== undefined) body.permissionPolicy = input.permission
      if (effectiveParent !== undefined) body.parentAgentId = effectiveParent
      if (input.closeOnTurnEnd === true) body.closeOnTurnEnd = true

      const parsed = parseCreateAgentBody(body)
      if (!parsed.ok) return jsonError(parsed.error.body.error)

      const created = await deps.orchestrator.createAndSpawn(parsed.value)
      const hostResult = await deps.agentSessionRegistry.getOrCreateHost(created.agentId)
      if (!hostResult.ok) {
        return jsonError(`session host did not start: ${hostResult.reason}`)
      }
      const sessionId = await waitForSessionId(
        deps.agentSessionRegistry,
        created.agentId,
        SESSION_OPEN_TIMEOUT_MS,
      )
      if (sessionId === undefined) {
        return jsonError("session did not come up within 30s")
      }
      const host = deps.agentSessionRegistry.getHost(created.agentId)
      return jsonResult({
        agent: created.agentId,
        sessionId,
        url: `${publicUrl}/chat/${input.cli}/${sessionId}?sessionTransport=http`,
        cli: cliMeta(input.cli),
        modes: host?.state.modes,
        configOptions: host?.state.configOptions,
        hint: MCP_CONFIGURE_HINT,
      })
    },
  )

  registerMcpWriteTools(
    server,
    registerArkTool,
    deps,
    scopeToken,
    scopeDeps,
    jsonResult,
    jsonError,
  )

  registerArkTool(
    server,
    "session_state",
    MCP_TOOL_META.session_state,
    SessionStateMcpInput,
    async (raw) => {
      const input = raw as typeof SessionStateMcpInput.infer
      const existing = await deps.registry.get(input.agent)
      if (!existing) return jsonError("agent not found")
      const host = deps.agentSessionRegistry.getHost(input.agent)
      if (!host) return jsonError("agent connection not found")
      return jsonResult({
        agent: input.agent,
        ...pickSessionState(host.state as unknown as Record<string, unknown>, input.fields),
      })
    },
  )

  // C3: notify_parent — only when caller is a known agent with a parent (§2ו).
  if (callerAgentId && callerRecord?.parentAgentId) {
    const parentId = callerRecord.parentAgentId
    registerArkTool(
      server,
      "notify_parent",
      MCP_NOTIFY_PARENT_META,
      AgentNotifyParentInput,
      async (raw) => {
        const input = raw as typeof AgentNotifyParentInput.infer
        const parentHostResult = await deps.agentSessionRegistry.getOrCreateHost(parentId)
        if (!parentHostResult.ok) {
          return jsonError(`parent session host did not start: ${parentHostResult.reason}`)
        }
        const { host: parentHost } = parentHostResult.entry
        const sessionId = parentHost.state.sessionId
        if (typeof sessionId !== "string" || sessionId.length === 0) {
          return jsonError("parent has no sessionId")
        }

        void parentHost.prompt(sessionId, input.text).catch((e) => {
          log.warn({ err: e, parentId, callerAgentId }, "notify_parent prompt failed")
        })
        return jsonResult({ ok: true, parent: parentId })
      },
    )
  }

  return server
}

/**
 * registerMcpHttp — mounts Streamable HTTP MCP at /api/mcp.
 * Transport + McpServer are built per request (stateless). Do not hoist them.
 */
export function registerMcpHttp(app: Hono, deps: McpHttpDeps): void {
  if (process.env.MCP_HTTP === "0") {
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
    const server = createSessionBusMcpServer(
      deps,
      { callerAgentId, scopeToken },
      callerRecord,
    )
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      await transport.close()
      await server.close()
    }
  })
}
