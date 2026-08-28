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
  AgentCloseInput,
  AgentListInput,
  AgentOpenInput,
  type AgentRegistry,
  toAgentPublic,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { type } from "arktype"
import type { Hono } from "hono"
import { z } from "zod"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { resolveAppVersion } from "../app-version.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { parseCreateAgentBody } from "./create-agent-input.js"

const log = createLogger("backend.mcp")

/** Same 30s cap as dispatch-via-api open / agent-cli open. */
const SESSION_OPEN_TIMEOUT_MS = 30_000
const SESSION_OPEN_POLL_MS = 1_500

export type McpHttpDeps = {
  registry: AgentRegistry
  orchestrator: AgentOrchestrator
  agentSessionRegistry: AgentSessionRegistry
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

function createSessionBusMcpServer(deps: McpHttpDeps): McpServer {
  const server = new McpServer({
    name: "drive-coding",
    version: resolveAppVersion(),
  })

  registerArkTool(
    server,
    "session_list",
    {
      title: "List sessions",
      description:
        "List live drive-coding agents (id, cliKind, cwd, status, turnState). Same surface as GET /api/agents.",
    },
    AgentListInput,
    async () => {
      const all = await deps.registry.list()
      const agents = all.map((a) => {
        const rt = deps.agentSessionRegistry.getRuntimeInfo(a.id)
        const host = deps.agentSessionRegistry.getHost(a.id)
        return {
          ...toAgentPublic(a),
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
    {
      title: "Open session",
      description:
        "Spawn a drive-coding agent and wait until its ACP session exists. Returns agent, sessionId, url, modes, configOptions.",
    },
    AgentOpenInput,
    async (raw) => {
      const input = raw as typeof AgentOpenInput.infer
      const publicUrl = (input.publicUrl ?? input.base ?? defaultPublicUrl()).replace(/\/$/, "")
      const env: Record<string, string> = { ...(input.env ?? {}) }
      env.DRIVE_CODING_BASE = publicUrl
      env.DC_BASE = publicUrl
      if (input.parent !== undefined && input.parent !== "") env.DC_PARENT = input.parent

      const body: Record<string, unknown> = {
        cliKind: input.cli,
        cwd: input.cwd,
        env,
      }
      if (input.permission !== undefined) body.permissionPolicy = input.permission

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
        modes: host?.state.modes,
        configOptions: host?.state.configOptions,
      })
    },
  )

  registerArkTool(
    server,
    "session_close",
    {
      title: "Close session",
      description:
        "Delete the agent and kill its CLI. Refuses when turnState is not idle unless force is true. The signal is turnState, not busy.",
    },
    AgentCloseInput,
    async (raw) => {
      const input = raw as typeof AgentCloseInput.infer
      const existing = await deps.registry.get(input.agent)
      if (!existing) {
        return jsonResult({ ok: true, alreadyClosed: true, agent: input.agent })
      }
      const turnState = deps.agentSessionRegistry.getHost(input.agent)?.state.turnState
      if (turnState !== undefined && turnState !== "idle" && input.force !== true) {
        return jsonError(`turnState=${turnState} — turn is open. wait, or pass force.`)
      }
      await deps.orchestrator.deleteAndKill(input.agent)
      return jsonResult({ ok: true, agent: input.agent })
    },
  )

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
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = createSessionBusMcpServer(deps)
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      await transport.close()
      await server.close()
    }
  })
}
