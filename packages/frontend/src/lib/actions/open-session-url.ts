/**
 * open-session-url.ts — orchestration for cold/warm session URL entry.
 *
 * Returns an outcome; does not navigate or render — testable without router.
 *
 * ─── slice session-url C2: נקודת-הזרקה שלישית של sessionTransport ───
 * readSessionTransport כאן (כמו handleReconnect ב-+page.svelte) — מכוון,
 * לא הפרה של connect-agent.ts. ר' connect-agent.ts להערה מעודכנת.
 */

import { env } from "$env/dynamic/public"
import { listAgents } from "$lib/adapters/agents-api"
import { readSessionTransport } from "$lib/session/session-transport-read"
import { pickSessionHost } from "$lib/session/session-url"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"

export type OpenSessionOutcome = "connected" | "not-found" | "needs-takeover" | "error"

const OWNED_AGENT_KEY = "dc.ownedAgentId"

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
    if (session.sessionsError !== null) return "error"

    const info = session.sessions.find((s) => s.sessionId === sessionId)
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

  if (pick.kind === "none" || pick.kind === "warm") return "not-found"

  const agent = pick.agent

  const ownedId =
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem(OWNED_AGENT_KEY) : null
  if (agent.attached === true && ownedId !== agent.id && !confirmedTakeover) {
    return "needs-takeover"
  }

  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })

  if (transport === "http") {
    await session.attachRemoteToLiveAgent({
      agentId: agent.id,
      cwd: agent.cwd,
      cliKind: agent.cliKind,
    })
  } else {
    await session.attachToLiveAgent({
      agentId: agent.id,
      sessionId,
      cwd: agent.cwd,
      cliKind: agent.cliKind,
    })
  }

  if (connectionFailed(session)) return "error"
  return "connected"
}
