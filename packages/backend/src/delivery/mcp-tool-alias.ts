import { MCP_TOOL_ALIASES, MCP_TOOL_META } from "@drive-coding/core"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { type } from "arktype"
import { z } from "zod"

type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: true
  _meta?: Record<string, unknown>
}

type ToolMeta = { title: string; description: string }
type ArkInput<T> = { toJsonSchema: () => object; (data: unknown): T | type.errors }
type LegacyName = keyof typeof MCP_TOOL_ALIASES
type ErrorCode = "agent_not_found" | "agent_host_unavailable" | "no_active_acp_session"

export class McpToolError extends Error {
  constructor(
    message: string,
    readonly code?: ErrorCode,
  ) {
    super(message)
  }
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}

export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value))
}

function errorResult(message: string, code?: ErrorCode): ToolResult {
  return {
    ...textResult(message),
    isError: true,
    ...(code === undefined ? {} : { _meta: { "drive-coding/errorCode": code } }),
  }
}

export function registerArkTool<T>(
  server: McpServer,
  name: string,
  meta: ToolMeta,
  ark: ArkInput<T>,
  handler: (parsed: T) => Promise<ToolResult>,
): void {
  registerTool(server, name, meta, ark, handler)
}

function registerTool<T>(
  server: McpServer,
  name: string,
  meta: ToolMeta,
  ark: ArkInput<T>,
  handler: (parsed: T) => Promise<ToolResult>,
  canonical = false,
): void {
  const { $schema: _schema, ...schema } = ark.toJsonSchema() as Record<string, unknown>
  server.registerTool(name, { ...meta, inputSchema: z.fromJSONSchema(schema) }, async (args) => {
    const parsed = ark(args ?? {})
    if (parsed instanceof type.errors) return errorResult(parsed.summary)
    try {
      return await handler(parsed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!canonical) return errorResult(message)
      const classified =
        error instanceof McpToolError ? error : error instanceof Error ? error.cause : undefined
      return errorResult(message, classified instanceof McpToolError ? classified.code : undefined)
    }
  })
}

export function registerToolPair<Input, Value, CanonicalInput = Input>(
  server: McpServer,
  legacy: LegacyName,
  schema: ArkInput<Input>,
  run: (input: Input) => Promise<Value>,
  options: {
    input?: { schema: ArkInput<CanonicalInput>; normalize: (input: CanonicalInput) => Input }
    project?: (value: Value) => unknown
    serialize?: (value: Value) => ToolResult
  } = {},
): void {
  const canonical = MCP_TOOL_ALIASES[legacy]
  const serialize = options.serialize ?? jsonResult
  const canonicalResult = async (input: Input) => {
    const value = await run(input)
    return options.project === undefined ? serialize(value) : jsonResult(options.project(value))
  }
  registerArkTool(server, legacy, MCP_TOOL_META[legacy], schema, async (input) =>
    serialize(await run(input)),
  )
  const adapter = options.input
  if (adapter === undefined) {
    registerTool(server, canonical, MCP_TOOL_META[canonical], schema, canonicalResult, true)
  } else {
    registerTool(
      server,
      canonical,
      MCP_TOOL_META[canonical],
      adapter.schema,
      (input) => canonicalResult(adapter.normalize(input)),
      true,
    )
  }
}
