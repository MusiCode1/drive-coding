import type { Patch, SessionState } from "@drive-coding/core/session"
import type { ViewEmission } from "./session-view"

export type HistorySyncPort = {
  getState(): SessionState
  getLastVersion(): number
  getSessionId(): string | null
  setSessionId(id: string | null): void
  replace(state: SessionState, version: number): void
  emit(emission: ViewEmission): void
  warn(topic: string, detail?: Record<string, unknown>): void
  reconnected(): void
  resetReadMark(): void
  advanceWaterMark(patch: Patch): void
}
