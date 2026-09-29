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
import type { ManualTitleInput } from "$lib/view-models/agent-session-manual-title"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"

export type OpenSessionOutcome = "connected" | "not-found" | "needs-takeover" | "error"

const OWNED_AGENT_KEY = "dc.ownedAgentId"

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

function connectionFailed(session: AgentSession): boolean {
  return session.status !== "connected" || session.error !== null
}

export async function openSessionUrl(params: {
  cliKind: string
  sessionId: string
  session: AgentSession
  settings: Settings
  confirmedTakeover?: boolean
}): Promise<OpenSessionOutcome> {
  const { cliKind, sessionId, session, settings, confirmedTakeover = false } = params

  if (
    session.sessionId === sessionId &&
    (session.status === "connected" || session.status === "disconnected")
  ) {
    return "connected"
  }

  if (session.status === "connected" && session.cliKind === cliKind) {
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

  if (pick.kind === "none") return "not-found"

  const agent = pick.agent

  const ownedId =
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem(OWNED_AGENT_KEY) : null
  if (
    agent.attached === true &&
    agent.attachedVia === "ws" &&
    ownedId !== agent.id &&
    !confirmedTakeover
  ) {
    return "needs-takeover"
  }

  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })

  const attachSessionId = pick.kind === "exact" ? sessionId : agent.acpSessionId
  if (!attachSessionId) return "not-found"

  if (transport === "http") {
    await session.attachRemoteToLiveAgent({
      agentId: agent.id,
      cwd: agent.cwd,
      cliKind: agent.cliKind,
      ...sessionAttachExtras(agent),
    })
  } else {
    await session.attachToLiveAgent({
      agentId: agent.id,
      sessionId: attachSessionId,
      cwd: agent.cwd,
      cliKind: agent.cliKind,
      ...sessionAttachExtras(agent),
    })
  }

  if (connectionFailed(session)) return "error"

  if (pick.kind === "warm") {
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
  }

  return "connected"
}
