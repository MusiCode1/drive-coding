/**
 * session-memory-mcp-tools.ts — MCP tools for shared session memory (slice session-memory C1).
 *
 * All three tools operate on the caller's agent record only (X-Drive-Coding-Agent).
 */

import {
  MCP_TOOL_META,
  McpSessionFieldDeleteInput,
  McpSessionFieldSetInput,
  McpSessionNoteSetInput,
  type AgentRegistry,
} from "@drive-coding/core"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import type { McpRequestContext } from "./http-mcp.js"

type ArkRegister = (
  server: McpServer,
  name: string,
  meta: { title: string; description: string },
  ark: { toJsonSchema: () => object; (data: unknown): unknown },
  handler: (parsed: unknown) => Promise<{
    content: Array<{ type: "text"; text: string }>
    isError?: true
  }>,
) => void

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] }
}

function jsonError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] }
}

function requireCaller(
  callerAgentId: string | undefined,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
): string | { isError: true; content: Array<{ type: "text"; text: string }> } {
  if (!callerAgentId || !callerRecord) {
    return jsonError(
      `${AGENT_ID_HEADER} required — call with the header set to your registered agent UUID`,
    )
  }
  return callerAgentId
}

function trimFieldKey(key: string): string | null {
  const trimmed = key.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function registerSessionMemoryMcpTools(
  server: McpServer,
  deps: { registry: AgentRegistry },
  ctx: McpRequestContext,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
  registerArkTool: ArkRegister,
): void {
  const callerAgentId = ctx.callerAgentId

  registerArkTool(
    server,
    "session_note_set",
    MCP_TOOL_META.session_note_set,
    McpSessionNoteSetInput,
    async (raw) => {
      const caller = requireCaller(callerAgentId, callerRecord)
      if (typeof caller !== "string") return caller
      const input = raw as typeof McpSessionNoteSetInput.infer
      await deps.registry.update(caller, { userNotes: input.text })
      return jsonResult({ ok: true })
    },
  )

  registerArkTool(
    server,
    "session_field_set",
    MCP_TOOL_META.session_field_set,
    McpSessionFieldSetInput,
    async (raw) => {
      const caller = requireCaller(callerAgentId, callerRecord)
      if (typeof caller !== "string") return caller
      const input = raw as typeof McpSessionFieldSetInput.infer
      const key = trimFieldKey(input.key)
      if (key === null) return jsonError("field key must be non-empty after trim")
      const existing = (await deps.registry.get(caller))?.sessionFields ?? {}
      await deps.registry.update(caller, { sessionFields: { ...existing, [key]: input.value } })
      return jsonResult({ ok: true })
    },
  )

  registerArkTool(
    server,
    "session_field_delete",
    MCP_TOOL_META.session_field_delete,
    McpSessionFieldDeleteInput,
    async (raw) => {
      const caller = requireCaller(callerAgentId, callerRecord)
      if (typeof caller !== "string") return caller
      const input = raw as typeof McpSessionFieldDeleteInput.infer
      const key = trimFieldKey(input.key)
      if (key === null) return jsonError("field key must be non-empty after trim")
      const record = await deps.registry.get(caller)
      if (!record) return jsonError("agent not found")
      const existing = record.sessionFields ?? {}
      if (!(key in existing)) return jsonResult({ ok: true })
      const { [key]: _removed, ...rest } = existing
      await deps.registry.update(caller, { sessionFields: rest })
      return jsonResult({ ok: true })
    },
  )
}
