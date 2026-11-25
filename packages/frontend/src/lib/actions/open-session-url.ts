/**
 * open-session-url.ts — orchestration for cold/warm session URL entry.
 *
 * Returns an outcome; does not navigate or render — testable without router.
 *
 * sessionTransport injection (see connect-agent.ts).
 */

import type { AgentPublic } from "@drive-coding/core"
import { env } from "$env/dynamic/public"
import { listAgents } from "$lib/adapters/agents-api"
import { readSessionTransport } from "$lib/session/session-transport-read"
import { pickSessionHost } from "$lib/session/session-url"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { ManualTitleInput } from "$lib/view-models/agent-session-manual-title"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import type { Settings } from "$lib/view-models/settings.svelte"
import { openSessionCold } from "./open-session-cold.js"
import { connectionFailed } from "./session-connection.js"

export type OpenSessionOutcome = "connected" | "not-found" | "busy" | "error"

export function sessionAttachExtras(agent: AgentPublic): ManualTitleInput {
  const out: ManualTitleInput = {}
  if (agent.titleManual === true) {
    out.titleManual = true
    if (agent.title != null) out.title = agent.title
  }
  if (agent.userNotes !== undefined) out.userNotes = agent.userNotes
  if (agent.sessionFields !== undefined) out.sessionFields = agent.sessionFields
  return out
}

export async function openSessionUrl(params: {
  cliKind: string
  sessionId: string
  session: AgentSession
  settings: Settings
}): Promise<OpenSessionOutcome> {
  const { cliKind, sessionId, session, settings } = params

  if (
    session.sessionId === sessionId &&
    (session.status === "connected" || session.status === "disconnected")
  ) {
    return "connected"
  }

  if (session.status === "connected" && session.cliKind === cliKind) {
    if (session.turnState !== "idle") return "busy"
    await session.listSessions(true)
    if (session.sessionsCache.error !== null) return "error"

    const info = session.sessionsCache.sessions.find((s) => s.sessionId === sessionId)
    if (!info) return "not-found"

    try {
      await session.switchSession({
        sessionId,
        cwd: info.cwd,
        cliKind,
        title: info.title,
      })
    } catch {
      return "error"
    }

    if (connectionFailed(session)) return "error"
    return "connected"
  }

  const agents = await listAgents()
  const pick = pickSessionHost(agents, cliKind, sessionId)

  if (pick.kind === "none") return openSessionCold({ cliKind, sessionId, session, settings })

  const agent = pick.agent

  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })

  try {
    await session.attachRemoteToLiveAgent({
      agentId: agent.id,
      cwd: agent.cwd,
      cliKind: agent.cliKind,
      transport,
      ...sessionAttachExtras(agent),
    })
  } catch (e) {
    session.error = formatAcpError(e)
    return "error"
  }

  if (session.status === "disconnected" && session.sessionId === sessionId) return "connected"
  if (connectionFailed(session)) return "error"

  return "connected"
}
