import {
  AgentOpenInput,
  MCP_AGENT_CONFIGURE_HINT,
  MCP_CONFIGURE_HINT,
  McpAgentOpenInput,
} from "@drive-coding/core"
import { getCliSpec } from "@drive-coding/provider/config"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { AGENT_ID_HEADER } from "../agent-identity.js"
import { checkNotifyOnDoneScope, SCOPE_DENIED_BODY } from "../scope-write.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"
import { applyNotifyOnDoneToOpenBody } from "./agent-events-mcp-tools.js"
import { parseCreateAgentBody } from "./create-agent-input.js"
import type { McpHttpDeps, McpRequestContext } from "./http-mcp.js"
import { McpToolError, registerToolPair } from "./mcp-tool-alias.js"
import { defaultPublicUrl, loopbackBaseUrl } from "./public-url.js"
import { applySessionOpenCreateFields } from "./session-open-body.js"
import { withSessionOpenRollback } from "./session-open-rollback.js"

/** Same 30s cap as dispatch-via-api open / agent-cli open. */
const SESSION_OPEN_TIMEOUT_MS = 30_000
const SESSION_OPEN_POLL_MS = 1_500

async function waitForSessionId(
  registry: AgentSessionRegistry,
  agentId: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const sid = registry.getHost(agentId)?.state.sessionId
    if (typeof sid === "string" && sid.length > 0) return sid
    if (Date.now() >= deadline) return undefined
    await new Promise((r) => setTimeout(r, SESSION_OPEN_POLL_MS))
  }
}

export function cliMeta(
  kind: string,
  env: NodeJS.ProcessEnv,
): { kind: string; displayName: string } {
  const spec = getCliSpec(kind, env)
  return { kind, displayName: spec?.displayName ?? kind }
}

export function registerMcpOpenTool(
  server: McpServer,
  deps: McpHttpDeps,
  { callerAgentId, scopeToken }: McpRequestContext,
): void {
  registerToolPair(
    server,
    "session_open",
    AgentOpenInput,
    async (input) => {
      const explicit = input.publicUrl ?? input.base
      const chatBase = (explicit ?? defaultPublicUrl(deps.urlConfig)).replace(/\/$/, "")
      const env: Record<string, string> = { ...(input.env ?? {}) }

      const headerParent = callerAgentId
      const explicitParent =
        input.parent !== undefined && input.parent !== "" ? input.parent : undefined

      if (headerParent && explicitParent && explicitParent !== headerParent) {
        throw new McpToolError(
          `${AGENT_ID_HEADER} (${headerParent}) conflicts with explicit parent (${explicitParent})`,
        )
      }

      const effectiveParent = headerParent ?? explicitParent
      if (effectiveParent !== undefined) env.DC_PARENT = effectiveParent

      const body: Record<string, unknown> = {
        cliKind: input.cli,
        cwd: input.cwd,
        env,
      }
      applySessionOpenCreateFields(body, input, effectiveParent)
      applyNotifyOnDoneToOpenBody(body, input.notifyOnDone, input.includeLastAssistantText)

      const parsed = parseCreateAgentBody(body, deps.env, {
        sidecarSizeBase: (explicit ?? loopbackBaseUrl(deps.urlConfig)).replace(/\/$/, ""),
      })
      if (!parsed.ok) throw new McpToolError(parsed.error.body.error)

      const subscriberId = parsed.value.notifyOnDone
      if (
        subscriberId &&
        !(await checkNotifyOnDoneScope(scopeToken, subscriberId, {
          registry: deps.registry,
          sessionRegistry: deps.agentSessionRegistry,
        }))
      ) {
        throw new McpToolError(JSON.stringify(SCOPE_DENIED_BODY))
      }

      const created = await deps.orchestrator.createAndSpawn(parsed.value)
      return withSessionOpenRollback(deps, created.agentId, async () => {
        const hostResult = await deps.agentSessionRegistry.getOrCreateHost(created.agentId)
        if (!hostResult.ok) {
          throw new McpToolError(
            `session host did not start: ${hostResult.reason}`,
            "agent_host_unavailable",
          )
        }
        const sessionId = await waitForSessionId(
          deps.agentSessionRegistry,
          created.agentId,
          SESSION_OPEN_TIMEOUT_MS,
        )
        if (sessionId === undefined) {
          throw new Error("session did not come up within 30s")
        }
        const host = deps.agentSessionRegistry.getHost(created.agentId)
        return {
          agent: created.agentId,
          sessionId,
          url: `${chatBase}/chat/${input.cli}/${sessionId}?sessionTransport=http`,
          cli: cliMeta(input.cli, deps.env),
          modes: host?.state.modes,
          configOptions: host?.state.configOptions,
          hint: MCP_CONFIGURE_HINT,
        }
      })
    },
    {
      input: {
        schema: McpAgentOpenInput,
        normalize: (input) => ({
          cli: input.cliKind,
          cwd: input.cwd,
          env: input.env,
          permission: input.permissionPolicy,
          parent: input.parentAgentId,
          closeOnTurnEnd: input.closeOnTurnEnd,
          notifyOnDone: input.subscribeOnOpenAgentId,
          includeLastAssistantText: input.includeLastAssistantText,
          publicUrl: input.publicUrl,
          systemPrompt: input.systemPrompt,
          roleLabel: input.roleLabel,
        }),
      },
      project: ({ agent, hint: _hint, ...result }) => ({
        agentId: agent,
        ...result,
        hint: MCP_AGENT_CONFIGURE_HINT,
      }),
    },
  )
}
