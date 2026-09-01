/**
 * mcp-write-tools.ts — scoped MCP write tools (session_close / session_send) (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ../agent-scope.ts

import {
  AgentCloseInput,
  type AgentRegistry,
  AgentSendInput,
  MCP_TOOL_META,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { ScopeEnforcementDeps } from "../bind-scope-enforcement.js"
import { raceKeepRunning } from "../session-host/http/rpc-wait.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { scopeDeniedBody } from "../scope-write.js"
import { runScopedMcpTool } from "./mcp-scope.js"

const log = createLogger("backend.mcp")

const SESSION_SEND_TIMEOUT_SEC = 1800

type ToolResult = {
  isError?: true
  content: Array<{ type: "text"; text: string }>
}

type RegisterTool = (
  server: McpServer,
  name: string,
  meta: { title: string; description: string },
  ark: { toJsonSchema: () => object; (data: unknown): unknown },
  handler: (parsed: unknown) => Promise<ToolResult>,
) => void

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

export function registerMcpWriteTools(
  server: McpServer,
  registerArkTool: RegisterTool,
  deps: {
    registry: AgentRegistry
    orchestrator: AgentOrchestrator
    agentSessionRegistry: AgentSessionRegistry
  },
  scopeToken: string | undefined,
  scopeDeps: ScopeEnforcementDeps,
  jsonResult: (value: unknown) => ToolResult,
  jsonError: (message: string) => ToolResult,
): void {
  registerArkTool(
    server,
    "session_close",
    MCP_TOOL_META.session_close,
    AgentCloseInput,
    async (raw) => {
      const input = raw as typeof AgentCloseInput.infer
      return runScopedMcpTool(
        scopeToken,
        scopeDeps,
        input.agent,
        "close",
        async () => {
          const existing = await deps.registry.get(input.agent)
          if (!existing) {
            return jsonResult({ ok: true, alreadyClosed: true, agent: input.agent })
          }
          const turnState = deps.agentSessionRegistry.getHost(input.agent)?.state.turnState
          if (turnState !== undefined && turnState !== "idle" && input.force !== true) {
            return jsonError(`turnState=${turnState} — turn is open. wait, or pass force.`)
          }
          await deps.orchestrator.deleteAndKill(input.agent)
          return jsonResult({ ok: true, agent: input.agent })
        },
        () => jsonError(JSON.stringify(scopeDeniedBody())),
      )
    },
  )

  registerArkTool(
    server,
    "session_send",
    MCP_TOOL_META.session_send,
    AgentSendInput,
    async (raw) => {
      const input = raw as typeof AgentSendInput.infer
      return runScopedMcpTool(
        scopeToken,
        scopeDeps,
        input.agent,
        "send",
        async () => {
          const existing = await deps.registry.get(input.agent)
          if (!existing) return jsonError("agent not found")

          const hostResult = await deps.agentSessionRegistry.getOrCreateHost(input.agent)
          if (!hostResult.ok) {
            return jsonError(`session host did not start: ${hostResult.reason}`)
          }
          const { host } = hostResult.entry
          deps.agentSessionRegistry.touchOwner(input.agent)

          const sessionId = host.state.sessionId
          if (typeof sessionId !== "string" || sessionId.length === 0) {
            return jsonError("no sessionId — run session_open first")
          }

          if (input.sets) {
            for (const [configId, value] of Object.entries(input.sets)) {
              await host.setConfigOption(configId, value)
            }
          }

          if (input.noWait === true) {
            const promptWork = host.prompt(sessionId, input.prompt)
            void promptWork.catch((e) => {
              log.warn({ err: e }, "prompt turn failed")
            })
            return jsonResult({ running: true })
          }

          const timeoutMs = (input.timeoutSec ?? SESSION_SEND_TIMEOUT_SEC) * 1000
          const from = host.state.messages.length
          const promptWork = host.prompt(sessionId, input.prompt)
          const raced = await raceKeepRunning(promptWork, timeoutMs, (e) => {
            log.warn({ err: e }, "prompt turn failed")
          })
          if (raced.outcome === "timedOut") {
            return jsonResult({ running: true })
          }
          const messagesSince = host.state.messages.slice(from)
          const text = assistantTextSince(messagesSince)
          if (raced.outcome === "rejected") {
            const err = host.state.lastTurnError
            return jsonResult({
              stopReason:
                err?.message ??
                (raced.error instanceof Error ? raced.error.message : String(raced.error)),
              lastTurnError: err,
              text,
              messagesSince,
            })
          }
          return jsonResult({
            stopReason: host.state.lastTurnError?.message ?? "end_turn",
            lastTurnError: host.state.lastTurnError,
            text,
            messagesSince,
          })
        },
        () => jsonError(JSON.stringify(scopeDeniedBody())),
      )
    },
  )
}
