import type { SessionState } from "@drive-coding/core/session"
import type { AgentSession, TurnState } from "./agent-session.svelte"
import { syncTitleFromViewState } from "./agent-session-manual-title"

type SessionMetadata = Pick<
  AgentSession,
  | "turnState"
  | "sessionTitle"
  | "contextUsage"
  | "availableCommands"
  | "modes"
  | "configOptions"
  | "quota"
  | "error"
> &
  Parameters<typeof syncTitleFromViewState>[0]

export function syncViewMetadata(
  session: SessionMetadata,
  state: SessionState,
  setTurnState: (turn: TurnState) => void,
) {
  if (state.turnState !== session.turnState) setTurnState(state.turnState as TurnState)
  syncTitleFromViewState(session, state.title)
  if (state.contextUsage !== session.contextUsage) {
    session.contextUsage = state.contextUsage as typeof session.contextUsage
  }
  session.availableCommands = state.commands as typeof session.availableCommands
  session.modes = state.modes as typeof session.modes
  session.configOptions = state.configOptions as typeof session.configOptions
  if (state.quota !== session.quota) session.quota = state.quota
}

export function syncViewTurnError(
  session: Pick<AgentSession, "error">,
  state: SessionState,
  errorFromTurn: string | null,
): string | null {
  if (state.lastTurnError) {
    session.error = `prompt failed: ${state.lastTurnError.message}`
    return session.error
  }
  // A new turn clears only the error produced by the previous turn.
  if (session.error !== null && session.error === errorFromTurn) {
    session.error = null
  }
  return null
}
