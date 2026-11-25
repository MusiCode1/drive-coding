/**
 * mcp-write-tools.ts — scoped MCP write tools (session_close / session_send) (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ../agent-scope.ts

import {
  AgentCloseInput,
  type AgentRegistry,
  AgentSendInput,
  McpAgentCloseInput,
  McpAgentSendInput,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { RPC_METHODS } from "@drive-coding/core/session"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { recordPromptDispatch } from "../agent-scope.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { ScopeEnforcementDeps } from "../bind-scope-enforcement.js"
import { guardMcpWrite } from "../bind-scope-enforcement.js"
import { scopeDeniedBody } from "../scope-write.js"
import { raceKeepRunning } from "../session-host/http/rpc-wait.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { type ResolvedSender, wrapPromptContent } from "./drive-message-source.js"
import { runScopedMcpTool } from "./mcp-scope.js"
import { McpToolError, registerToolPair } from "./mcp-tool-alias.js"

const log = createLogger("backend.mcp")

const SESSION_SEND_TIMEOUT_SEC = 1800

function assistantTextSince(messages: unknown[]): string {
  const parts: string[] = []
  for (const m of messages) {
    if (typeof m !== "object" || m === null) continue
    const msg = m as { role?: string; segments?: Array<{ text?: string }> }
    if (msg.role !== "assistant") continue
    for (const s of msg.segments ?? []) {
      if (typeof s.text === "string") parts.push(s.text)
    }
  }
  return parts.join("")
}

function scopeDenied(): never {
  throw new McpToolError(JSON.stringify(scopeDeniedBody()))
}

export function registerMcpWriteTools(
  server: McpServer,
  deps: {
    registry: AgentRegistry
    orchestrator: AgentOrchestrator
    agentSessionRegistry: AgentSessionRegistry
  },
  scopeToken: string | undefined,
  scopeDeps: ScopeEnforcementDeps,
  sender?: ResolvedSender,
): void {
  registerToolPair(
    server,
    "session_close",
    AgentCloseInput,
    async (input) => {
      return runScopedMcpTool(
        scopeToken,
        scopeDeps,
        input.agent,
        "close",
        async () => {
          const existing = await deps.registry.get(input.agent)
          if (!existing) {
            return { ok: true, alreadyClosed: true, agent: input.agent }
          }
          const turnState = deps.agentSessionRegistry.getHost(input.agent)?.state.turnState
          if (turnState !== undefined && turnState !== "idle" && input.force !== true) {
            throw new McpToolError(`turnState=${turnState} — turn is open. wait, or pass force.`)
          }
          await deps.orchestrator.deleteAndKill(input.agent)
          return { ok: true, agent: input.agent }
        },
        scopeDenied,
      )
    },
    {
      input: {
        schema: McpAgentCloseInput,
        normalize: ({ agentId, force }) => ({ agent: agentId, force }),
      },
      project: ({ agent, ...result }) => ({ ...result, agentId: agent }),
    },
  )

  registerToolPair(
    server,
    "session_send",
    AgentSendInput,
    async (input) => {
      const setKeys = input.sets ? Object.keys(input.sets) : []
      if (setKeys.length > 0) {
        const updateOk = await guardMcpWrite(
          scopeToken,
          scopeDeps,
          input.agent,
          RPC_METHODS.setConfigOption,
        )
        if (!updateOk) scopeDenied()
      }
      const messageOk = await guardMcpWrite(scopeToken, scopeDeps, input.agent, "send")
      if (!messageOk) scopeDenied()

      const existing = await deps.registry.get(input.agent)
      if (!existing) throw new McpToolError("agent not found", "agent_not_found")

      const hostResult = await deps.agentSessionRegistry.getOrCreateHost(input.agent)
      if (!hostResult.ok) {
        throw new McpToolError(
          `session host did not start: ${hostResult.reason}`,
          "agent_host_unavailable",
        )
      }
      const { host } = hostResult.entry

      const sessionId = host.state.sessionId
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new McpToolError("no sessionId — run session_open first", "no_active_acp_session")
      }

      if (input.sets) {
        for (const [configId, value] of Object.entries(input.sets)) {
          await host.setConfigOption(configId, value)
        }
      }

      const promptContent = wrapPromptContent(sender, input.prompt)
      const from = input.noWait === true ? 0 : host.state.messages.length
      recordPromptDispatch(scopeToken, input.agent)
      const promptWork = host.prompt(sessionId, promptContent)

      if (input.noWait === true) {
        void promptWork.catch((e) => {
          log.warn({ err: e }, "prompt turn failed")
        })
        return { running: true }
      }

      const timeoutMs = (input.timeoutSec ?? SESSION_SEND_TIMEOUT_SEC) * 1000
      const raced = await raceKeepRunning(promptWork, timeoutMs, (e) => {
        log.warn({ err: e }, "prompt turn failed")
      })
      if (raced.outcome === "timedOut") {
        return { running: true }
      }
      const messagesSince = host.state.messages.slice(from)
      const text = assistantTextSince(messagesSince)
      if (raced.outcome === "rejected") {
        const err = host.state.lastTurnError
        return {
          stopReason:
            err?.message ??
            (raced.error instanceof Error ? raced.error.message : String(raced.error)),
          lastTurnError: err,
          text,
          messagesSince,
        }
      }
      return {
        stopReason: host.state.lastTurnError?.message ?? "end_turn",
        lastTurnError: host.state.lastTurnError,
        text,
        messagesSince,
      }
    },
    {
      input: {
        schema: McpAgentSendInput,
        normalize: ({ agentId, prompt, sets, timeoutSec, noWait }) => ({
          agent: agentId,
          prompt,
          sets,
          timeoutSec,
          noWait,
        }),
      },
    },
  )
}
