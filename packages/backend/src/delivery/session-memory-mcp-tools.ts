/**
 * session-memory-mcp-tools.ts — MCP tools for shared session memory (slice session-memory C1).
 *
 * All three tools operate on the caller's agent record only (X-Drive-Coding-Agent).
 */

import {
  type AgentRegistry,
  McpSessionFieldDeleteInput,
  McpSessionFieldSetInput,
  McpSessionNoteSetInput,
} from "@drive-coding/core"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import type { McpRequestContext } from "./http-mcp.js"
import { McpToolError, registerToolPair } from "./mcp-tool-alias.js"

function requireCaller(
  callerAgentId: string | undefined,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
): string {
  if (!callerAgentId || !callerRecord) {
    throw new McpToolError(
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
): void {
  const callerAgentId = ctx.callerAgentId

  registerToolPair(server, "session_note_set", McpSessionNoteSetInput, async (input) => {
    const caller = requireCaller(callerAgentId, callerRecord)
    await deps.registry.update(caller, { userNotes: input.text })
    return { ok: true }
  })

  registerToolPair(server, "session_field_set", McpSessionFieldSetInput, async (input) => {
    const caller = requireCaller(callerAgentId, callerRecord)
    const key = trimFieldKey(input.key)
    if (key === null) throw new McpToolError("field key must be non-empty after trim")
    const existing = (await deps.registry.get(caller))?.sessionFields ?? {}
    await deps.registry.update(caller, { sessionFields: { ...existing, [key]: input.value } })
    return { ok: true }
  })

  registerToolPair(server, "session_field_delete", McpSessionFieldDeleteInput, async (input) => {
    const caller = requireCaller(callerAgentId, callerRecord)
    const key = trimFieldKey(input.key)
    if (key === null) throw new McpToolError("field key must be non-empty after trim")
    const record = await deps.registry.get(caller)
    if (!record) throw new McpToolError("agent not found", "agent_not_found")
    const existing = record.sessionFields ?? {}
    if (!Object.hasOwn(existing, key)) return { ok: true }
    const { [key]: _removed, ...rest } = existing
    await deps.registry.update(caller, { sessionFields: rest })
    return { ok: true }
  })
}
