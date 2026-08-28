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

import { AgentListInput, type AgentRegistry, toAgentPublic } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { type } from "arktype"
import type { Hono } from "hono"
import { z } from "zod"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { resolveAppVersion } from "../app-version.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"

const log = createLogger("backend.mcp")

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

function createSessionBusMcpServer(deps: McpHttpDeps): McpServer {
  const server = new McpServer({
    name: "drive-coding",
    version: resolveAppVersion(),
  })

  server.registerTool(
    "session_list",
    {
      title: "List sessions",
      description:
        "List live drive-coding agents (id, cliKind, cwd, status, turnState). Same surface as GET /api/agents.",
      inputSchema: inputSchemaFromArk(AgentListInput),
    },
    async (args) => {
      const parsed = AgentListInput(args ?? {})
      if (parsed instanceof type.errors) return jsonError(parsed.summary)
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
