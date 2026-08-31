/**
 * agent-events-mcp-tools.ts — MCP tools for agent event subscriptions (slice be-events-subscribe).
 */

import {
  AgentNotifyParentInput,
  AgentSubscribeInput,
  MCP_NOTIFY_PARENT_META,
  MCP_TOOL_META,
  type AgentRegistry,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import type { AgentEventBus } from "../session-host/agent-events.js"
import type { McpRequestContext } from "./http-mcp.js"

const log = createLogger("backend.mcp.agent-events")

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

type McpToolDeps = {
  registry: AgentRegistry
  agentSessionRegistry: AgentSessionRegistry
  eventBus: AgentEventBus
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] }
}

function jsonError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] }
}

/** Merge notifyOnDone from session_open input into the create body. */
export function applyNotifyOnDoneToOpenBody(
  body: Record<string, unknown>,
  notifyOnDone: string | undefined,
): void {
  if (notifyOnDone !== undefined && notifyOnDone !== "") {
    body.notifyOnDone = notifyOnDone
  }
}

export function registerAgentEventMcpTools(
  server: McpServer,
  deps: McpToolDeps,
  ctx: McpRequestContext,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
  registerArkTool: ArkRegister,
): void {
  const callerAgentId = ctx.callerAgentId

  registerArkTool(
    server,
    "session_subscribe",
    MCP_TOOL_META.session_subscribe,
    AgentSubscribeInput,
    async (raw) => {
      const input = raw as typeof AgentSubscribeInput.infer
      const target = await deps.registry.get(input.agent)
      if (!target) return jsonError("agent not found")

      const subscriberId =
        input.subscriber !== undefined && input.subscriber !== ""
          ? input.subscriber
          : callerAgentId
      if (!subscriberId) {
        return jsonError(
          `subscriber required — pass subscriber or ${AGENT_ID_HEADER} header`,
        )
      }
      deps.eventBus.subscribe(input.agent, subscriberId)
      return jsonResult({ ok: true, agent: input.agent, subscriber: subscriberId })
    },
  )

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
}
