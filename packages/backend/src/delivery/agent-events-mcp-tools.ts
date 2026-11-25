/**
 * agent-events-mcp-tools.ts — MCP tools for agent event subscriptions (slice be-events-subscribe).
 */

import {
  AgentNotifyParentInput,
  type AgentRegistry,
  AgentSubscribeInput,
  MCP_NOTIFY_PARENT_META,
  McpAgentSubscribeInput,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { checkScopedWrite, SCOPE_DENIED_BODY } from "../scope-write.js"
import type { AgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { senderFromRecord, wrapAgentText } from "./drive-message-source.js"
import type { McpRequestContext } from "./http-mcp.js"

import { jsonResult, McpToolError, registerArkTool, registerToolPair } from "./mcp-tool-alias.js"

const log = createLogger("backend.mcp.agent-events")

type McpToolDeps = {
  registry: AgentRegistry
  agentSessionRegistry: AgentSessionRegistry
  eventBus: AgentEventBus
}

/** Merge notifyOnDone and includeLastAssistantText from session_open input into the create body. */
export function applyNotifyOnDoneToOpenBody(
  body: Record<string, unknown>,
  notifyOnDone: string | undefined,
  includeLastAssistantText?: boolean,
): void {
  if (notifyOnDone !== undefined && notifyOnDone !== "") {
    body.notifyOnDone = notifyOnDone
  }
  if (includeLastAssistantText === true) {
    body.includeLastAssistantText = true
  }
}

export function registerAgentEventMcpTools(
  server: McpServer,
  deps: McpToolDeps,
  ctx: McpRequestContext,
  callerRecord: Awaited<ReturnType<AgentRegistry["get"]>>,
): void {
  const callerAgentId = ctx.callerAgentId

  registerToolPair(
    server,
    "session_subscribe",
    AgentSubscribeInput,
    async (input) => {
      const target = await deps.registry.get(input.agent)
      if (!target) throw new McpToolError("agent not found", "agent_not_found")

      const subscriberId =
        input.subscriber !== undefined && input.subscriber !== "" ? input.subscriber : callerAgentId
      if (!subscriberId) {
        throw new McpToolError(`subscriber required — pass subscriber or ${AGENT_ID_HEADER} header`)
      }
      return checkScopedWrite({
        token: ctx.scopeToken,
        targetId: subscriberId,
        watchedId: input.agent,
        verb: "subscribe",
        registry: deps.registry,
        sessionRegistry: deps.agentSessionRegistry,
      }).then((allowed) => {
        if (!allowed) throw new McpToolError(JSON.stringify(SCOPE_DENIED_BODY))
        deps.eventBus.subscribe(input.agent, subscriberId, {
          includeLastAssistantText: input.includeLastAssistantText === true,
        })
        return { ok: true, agent: input.agent, subscriber: subscriberId }
      })
    },
    {
      input: {
        schema: McpAgentSubscribeInput,
        normalize: ({ agentId, subscriberAgentId, includeLastAssistantText }) => ({
          agent: agentId,
          subscriber: subscriberAgentId,
          includeLastAssistantText,
        }),
      },
      project: ({ ok, agent, subscriber }) => ({
        ok,
        agentId: agent,
        subscriberAgentId: subscriber,
      }),
    },
  )

  if (callerAgentId && callerRecord?.parentAgentId) {
    const parentId = callerRecord.parentAgentId
    registerArkTool(
      server,
      "notify_parent",
      MCP_NOTIFY_PARENT_META,
      AgentNotifyParentInput,
      async (input) => {
        const parentHostResult = await deps.agentSessionRegistry.getOrCreateHost(parentId)
        if (!parentHostResult.ok) {
          throw new McpToolError(`parent session host did not start: ${parentHostResult.reason}`)
        }
        const { host: parentHost } = parentHostResult.entry
        const sessionId = parentHost.state.sessionId
        if (typeof sessionId !== "string" || sessionId.length === 0) {
          throw new McpToolError("parent has no sessionId")
        }

        const callerSender = callerRecord ? senderFromRecord(callerRecord) : undefined
        const text =
          callerSender !== undefined ? wrapAgentText(callerSender, input.text) : input.text
        void parentHost.prompt(sessionId, text).catch((e) => {
          log.warn({ err: e, parentId, callerAgentId }, "notify_parent prompt failed")
        })
        return jsonResult({ ok: true, parent: parentId })
      },
    )
  }
}
