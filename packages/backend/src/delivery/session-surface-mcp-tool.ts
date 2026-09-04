/**
 * session-surface-mcp-tool.ts — MCP session_surface (slice mcp-surface-tool).
 *
 * Same body as GET /api/agent-prompt, delivered over MCP instead of a CLI hook.
 *
 * Why this exists: the surface prompt normally reaches an agent through a
 * provider hook (`packages/provider/hooks/<cli>/`), which is a per-CLI,
 * per-machine **installation**. When that wiring is missing the agent never
 * learns what this product can do — measured 2026-09-05: a `claude` agent
 * running inside drive-coding started building an HTTP server and an SSH
 * tunnel to hand the user a file, because nothing told it `/api/fs/file`
 * existed. MCP is **discovery**, not installation: the tool shows up in
 * `tools/list` on its own, so it cannot silently fail to be wired.
 */

import { type AgentRegistry, MCP_TOOL_META, McpSessionSurfaceInput } from "@drive-coding/core"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { buildAgentPromptText } from "./http-agent-prompt.js"
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

function textResult(value: string) {
  return { content: [{ type: "text" as const, text: value }] }
}

function jsonError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] }
}

export function registerSessionSurfaceMcpTool(
  server: McpServer,
  deps: Pick<McpHttpDeps, "urlConfig">,
  ctx: McpRequestContext,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
  registerArkTool: ArkRegister,
): void {
  const callerAgentId = ctx.callerAgentId

  registerArkTool(
    server,
    "session_surface",
    MCP_TOOL_META.session_surface,
    McpSessionSurfaceInput,
    async () => {
      if (!callerAgentId || !callerRecord) {
        return jsonError(
          `${AGENT_ID_HEADER} required — call session_surface with the header set to your registered agent UUID`,
        )
      }

      // Text, not JSON: the body is a prompt meant to be read, and JSON.stringify
      // would escape every newline in a ~5.5KB markdown document.
      return textResult(
        buildAgentPromptText(
          {
            agentId: callerRecord.id,
            parentAgentId: callerRecord.parentAgentId,
            charter: callerRecord.systemPrompt ?? undefined,
          },
          deps.urlConfig,
        ),
      )
    },
  )
}
