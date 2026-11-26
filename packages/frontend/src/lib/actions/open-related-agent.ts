import type { AgentPublic } from "@drive-coding/core"
import type { MessageKey } from "@drive-coding/core/i18n"
import { isAgentRunning, reconnectState } from "$lib/adapters/reconnect-state"
import { sessionPathWithTransport } from "$lib/session/session-url"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { ReconnectAgentOutcome } from "./reconnect-agent"

type Session = Pick<
  AgentSession,
  | "agentId"
  | "error"
  | "leaveRunning"
  | "onSessionEnd"
  | "pendingElicitation"
  | "pendingPermission"
  | "sessionId"
  | "sessionTransport"
  | "status"
  | "turnState"
>

export interface RelatedAgentNavigation {
  currentUrl: () => string
  isNavigating: () => boolean
  goto: (url: string) => Promise<void>
  reopen: (url: string) => void
}

interface Input extends RelatedAgentNavigation {
  source: AgentPublic
  parent: () => AgentPublic | undefined
  session: Session
  reconnect: (agent: AgentPublic) => Promise<ReconnectAgentOutcome>
  t: (key: MessageKey) => string
}

type Outcome = "blocked" | "navigated" | "restored" | "failed" | "superseded"
const moving = new WeakSet<Session>()

function eligible(agent: AgentPublic | undefined): agent is AgentPublic {
  return !!agent && isAgentRunning(agent) && reconnectState(agent) !== "disabled"
}

export function relatedAgentBlock(
  session: Session,
  sourceId: string,
  parent: AgentPublic | undefined,
  navigating: boolean,
): MessageKey | undefined {
  const isSource = session.status === "connected" && session.agentId === sourceId
  if (!isSource || navigating || !session.sessionId) return "connect.agents.tree.transition"
  if (session.turnState !== "idle" || session.pendingPermission || session.pendingElicitation) {
    return "connect.agents.tree.waitIdle"
  }
  if (!eligible(parent)) return "connect.agents.tree.parentUnavailable"
}

function vacant(session: Session): boolean {
  return session.agentId === null && session.status === "idle"
}

export async function openRelatedAgent(input: Input): Promise<Outcome> {
  const { session, source, reconnect, currentUrl, isNavigating, goto, reopen, t } = input
  const parent = input.parent()
  const sourceSessionId = session.sessionId
  if (!parent || !sourceSessionId) return "blocked"
  if (moving.has(session) || relatedAgentBlock(session, source.id, parent, isNavigating())) {
    return "blocked"
  }

  const parentId = parent.id
  const origin = currentUrl()
  const sourceUrl =
    origin.split(/[?#]/, 1)[0] === "/chat"
      ? sessionPathWithTransport(source.cliKind, sourceSessionId, session.sessionTransport)
      : origin
  let targetUrl: string | undefined
  let superseded = false
  let leaving = false
  const stop = session.onSessionEnd((reason) => {
    if (!leaving || reason !== "leave-running") superseded = true
    leaving = false
  })
  const owns = (id: string | null) => {
    if (superseded || isNavigating() || ![origin, targetUrl].includes(currentUrl())) return false
    if (session.agentId === null) return session.status === "idle" || session.status === "error"
    return session.agentId === id && session.status !== "connecting"
  }
  const leave = () => {
    leaving = true
    return session.leaveRunning().finally(() => {
      leaving = false
    })
  }
  const isSource = () => session.agentId === source.id && session.sessionId === sourceSessionId
  const report = (restored: boolean, detail: string | null): Outcome => {
    const message = restored
      ? t("connect.agents.tree.returned")
      : `${t("connect.agents.tree.reopen")} ${sourceUrl}`
    session.error = detail ? `${message} ${detail}` : message
    return restored ? "restored" : "failed"
  }

  async function restore(detail: string | null): Promise<Outcome> {
    if (!owns(parentId)) return "superseded"
    if (!vacant(session)) await leave()
    if (!owns(null) || !vacant(session)) return "superseded"

    const outcome = await reconnect(source).catch(() => "error")
    if (!owns(source.id)) return "superseded"
    const restored = outcome === "navigated" && session.status === "connected" && isSource()
    const returned = restored && currentUrl() === origin
    const result = report(returned, detail)
    if (vacant(session) || (restored && !returned)) reopen(sourceUrl)
    return result
  }

  moving.add(session)
  try {
    await leave()
    if (!owns(null) || !vacant(session)) return "superseded"

    const target = input.parent()
    if (!eligible(target) || target.id !== parentId) return await restore(null)
    const outcome = await reconnect(target).catch(() => "error")
    if (!owns(target.id)) return "superseded"
    const sessionId = session.sessionId
    const attached = session.status === "connected" && session.agentId === target.id
    if (outcome !== "navigated" || !attached || !sessionId) return await restore(session.error)
    if (input.parent()?.id !== target.id) return await restore(null)

    targetUrl = sessionPathWithTransport(target.cliKind, sessionId, session.sessionTransport)
    const navigationError = await goto(targetUrl).catch(() => "failed")
    if (!owns(target.id) || session.sessionId !== sessionId) return "superseded"
    if (!navigationError && currentUrl() === targetUrl) return "navigated"
    return await restore(null)
  } catch {
    if (!owns(parentId) && !owns(source.id)) return "superseded"
    return report(isSource(), session.error)
  } finally {
    moving.delete(session)
    stop()
  }
}
