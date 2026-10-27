import type { Agent, BridgeKind } from "@drive-coding/core"
import type { SessionHistoryStore } from "../history/session-history-store.js"

export function recordHistoryAttachFromPatch(
  store: SessionHistoryStore,
  agentId: string,
  agent: Agent,
  acpSessionId: string,
  effectiveCwd: string,
): void {
  store.recordAttach({
    agentId,
    acpSessionId,
    cliKind: agent.cliKind as BridgeKind,
    cwd: effectiveCwd,
    now: Date.now(),
    openedByEmail: agent.openedByEmail,
    parentAgentId: agent.parentAgentId,
  })
}
