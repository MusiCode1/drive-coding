import type { HistoryMark } from "./history-mark"

export type SessionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error"

export type SessionTurnState = "idle" | "waiting" | "thinking" | "responding" | "calling-tool"

/** Read-only state that remains owned by the session core. */
export type SpeakerLifecycle = {
  readonly status: SessionStatus
  readonly turnState: SessionTurnState
  readonly isLoadingHistory: boolean
  readonly historyEpoch: number
  readonly historyMark: HistoryMark
  readonly lastUserMessage: string
  readonly recentAssistantMessages: (n: number) => string[]
}
