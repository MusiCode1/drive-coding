/**
 * session-messages-mcp-tool.ts — MCP session_messages (slice session-read-filter).
 *
 * Economical, read-only pull of ANOTHER session's history over MCP. Same wire
 * frames as `GET /api/agents/:id/history`, filtered so an agent fetches only
 * what it needs: conversation messages without the verbose tool-call frames,
 * or the reverse, and optionally without the session header.
 *
 * 🔴 **One source.** The body is `snapshotPayload(host.state, …)` — the exact
 * function `snapshotFrame` and the HTTP route build on. No parallel payload
 * assembly: two lookalike implementations diverge silently later.
 *
 * 🔴 **Read, not liveness.** `getHost` (never `getOrCreateHost`): a pull does
 * not create a host, reassign ownership, touch epoch, or count as an
 * activity signal. Unknown `fromMessage` → error, never a silent full dump —
 * the same strictness as the HTTP route.
 */

import { MCP_TOOL_META, SessionMessagesMcpInput } from "@drive-coding/core"
import { findMessageIndex, snapshotPayload } from "@drive-coding/core/session"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpHttpDeps } from "./http-mcp.js"

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

export function registerSessionMessagesMcpTool(
  server: McpServer,
  deps: Pick<McpHttpDeps, "registry" | "agentSessionRegistry">,
  registerArkTool: ArkRegister,
): void {
  registerArkTool(
    server,
    "session_messages",
    MCP_TOOL_META.session_messages,
    SessionMessagesMcpInput,
    async (raw) => {
      const input = raw as typeof SessionMessagesMcpInput.infer
      const existing = await deps.registry.get(input.agent)
      if (!existing) return jsonError("agent not found")
      const host = deps.agentSessionRegistry.getHost(input.agent)
      if (!host) return jsonError("agent connection not found")

      // ‏fromMessage לא-מוכר ⇒ שגיאה, לא היסטוריה מלאה בשקט — הדפוס של history.ts.
      const fromMessage = input.fromMessage
      if (
        fromMessage !== undefined &&
        fromMessage !== "" &&
        findMessageIndex(host.state, fromMessage) === -1
      ) {
        return jsonError(`unknown fromMessage: ${fromMessage}`)
      }

      const opts = {
        ...(input.kinds !== undefined ? { include: input.kinds } : {}),
        ...(input.withHeader !== undefined ? { withHeader: input.withHeader } : {}),
        ...(fromMessage !== undefined && fromMessage !== "" ? { fromMessage } : {}),
      }
      return jsonResult(snapshotPayload(host.state, undefined, opts))
    },
  )
}
