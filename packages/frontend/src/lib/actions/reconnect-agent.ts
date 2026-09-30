import type { AgentPublic } from "@drive-coding/core"
import { env } from "$env/dynamic/public"
import { readSessionTransport } from "$lib/session/session-transport-read"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import { sessionAttachExtras } from "./open-session-url"

export type ReconnectAgentOutcome = "navigated" | "error" | "skipped"

export async function reconnectAgent(deps: {
  agent: AgentPublic
  session: AgentSession
  settings: Settings
}): Promise<ReconnectAgentOutcome> {
  const { agent, session, settings } = deps
  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })

  try {
    if (transport === "http") {
      await session.attachRemoteToLiveAgent({
        agentId: agent.id,
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        ...sessionAttachExtras(agent),
      })
    } else {
      if (!agent.acpSessionId) return "skipped"
      await session.attachToLiveAgent({
        agentId: agent.id,
        sessionId: agent.acpSessionId,
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        ...sessionAttachExtras(agent),
      })
    }
  } catch (e) {
    session.error = formatAcpError(e)
    return "error"
  }

  if (session.status === "connected") return "navigated"
  if (session.status === "error") return "error"
  return "skipped"
}
