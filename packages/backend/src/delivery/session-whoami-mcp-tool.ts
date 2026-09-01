/**
 * session-whoami-mcp-tool.ts — MCP session_whoami (slice mcp-whoami).
 */

import {
  MCP_TOOL_META,
  McpSessionWhoamiInput,
  type AgentRegistry,
} from "@drive-coding/core"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import type { McpHttpDeps, McpRequestContext } from "./http-mcp.js"

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

export function registerSessionWhoamiMcpTool(
  server: McpServer,
  deps: Pick<McpHttpDeps, "agentSessionRegistry">,
  ctx: McpRequestContext,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
  registerArkTool: ArkRegister,
): void {
  const callerAgentId = ctx.callerAgentId

  registerArkTool(
    server,
    "session_whoami",
    MCP_TOOL_META.session_whoami,
    McpSessionWhoamiInput,
    async () => {
      if (!callerAgentId || !callerRecord) {
        return jsonError(
          `${AGENT_ID_HEADER} required — call session_whoami with the header set to your registered agent UUID`,
        )
      }
      const result: Record<string, unknown> = {
        agent: callerAgentId,
        cliKind: callerRecord.cliKind,
        cwd: callerRecord.cwd,
        hasParent: Boolean(callerRecord.parentAgentId),
      }
      if (callerRecord.parentAgentId !== undefined) {
        result.parentAgentId = callerRecord.parentAgentId
      }
      const sessionId = deps.agentSessionRegistry.getHost(callerAgentId)?.state.sessionId
      if (typeof sessionId === "string" && sessionId.length > 0) {
        result.sessionId = sessionId
      }
      return jsonResult(result)
    },
  )
}
