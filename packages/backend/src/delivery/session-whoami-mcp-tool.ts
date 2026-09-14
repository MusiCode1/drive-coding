/**
 * session-whoami-mcp-tool.ts — MCP session_whoami (slice mcp-whoami + mcp-whoami-runtime).
 */

import {
  MCP_TOOL_META,
  McpSessionWhoamiInput,
  type AgentRegistry,
} from "@drive-coding/core"
import { configDefault } from "@drive-coding/core/config/specs"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { readProcessRss } from "../adapters/read-process-rss.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { resolveAppVersion } from "../app-version.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import type { MemoryGuard } from "./memory-guard.js"
import { defaultPublicUrl, type UrlConfig } from "./public-url.js"
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

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

function resolvePublicBaseUrl(urlConfig: UrlConfig): string | undefined {
  if (urlConfig.publicBaseUrl === undefined || urlConfig.publicBaseUrl.length === 0) {
    return undefined
  }
  return stripTrailingSlash(defaultPublicUrl(urlConfig))
}

function collectBackendEnvelope(deps: {
  urlConfig: UrlConfig
  memoryGuard?: MemoryGuard
}): Record<string, unknown> {
  const { urlConfig, memoryGuard } = deps
  const port = urlConfig.port ?? configDefault("port")
  const mem = process.memoryUsage()
  const backend: Record<string, unknown> = {
    pid: process.pid,
    port,
    version: resolveAppVersion(),
    uptimeSec: Math.floor(process.uptime()),
    cwd: process.cwd(),
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      rssBudgetMB: memoryGuard?.rssBudgetMB() ?? configDefault("rssBudgetMb"),
      overBudget: memoryGuard?.overBudget() ?? false,
    },
  }
  const publicBaseUrl = resolvePublicBaseUrl(urlConfig)
  if (publicBaseUrl !== undefined) {
    backend.publicBaseUrl = publicBaseUrl
  }
  return backend
}

function collectRuntimeEnvelope(
  agentId: string,
  agentSessionRegistry: AgentSessionRegistry,
): Record<string, unknown> {
  const rt = agentSessionRegistry.getRuntimeInfo(agentId)
  if (!rt) {
    return {
      cliPid: null,
      attached: false,
      busy: false,
      memory: null,
      source: "unavailable",
    }
  }

  const runtime: Record<string, unknown> = {
    cliPid: rt.pid,
    attached: rt.attached,
    busy: rt.busy,
  }
  if (rt.via != null) runtime.via = rt.via

  const childMem = rt.pid != null ? readProcessRss(rt.pid) : null
  if (childMem) {
    runtime.memory = childMem
  } else {
    runtime.memory = null
    runtime.source = "unavailable"
  }
  return runtime
}

export function registerSessionWhoamiMcpTool(
  server: McpServer,
  deps: Pick<McpHttpDeps, "agentSessionRegistry" | "urlConfig" | "memoryGuard">,
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
        backend: collectBackendEnvelope(deps),
        runtime: collectRuntimeEnvelope(callerAgentId, deps.agentSessionRegistry),
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
