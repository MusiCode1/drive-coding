import type { Patch, SessionState } from "@drive-coding/core/session"
import { HistorySync } from "./history-sync"
import type { HistorySyncPort } from "./history-sync-port"
import type { ViewEmission } from "./session-view"
import type { FrameReader } from "./wire/frame-reader"
import type { SessionPipe } from "./wire/pipe"

export type RemoteHistoryPortBinding = {
  getState(): SessionState
  getLastVersion(): number
  getSessionId(): string | null
  setSessionId(id: string | null): void
  setState(state: SessionState, version: number): void
  emit(emission: ViewEmission): void
  onReconnected(): void
  resetReadMark(): void
  advanceWaterMark(patch: Patch): void
}

export function createRemoteHistoryPort(bind: RemoteHistoryPortBinding): HistorySyncPort {
  return {
    getState: () => bind.getState(),
    getLastVersion: () => bind.getLastVersion(),
    getSessionId: () => bind.getSessionId(),
    setSessionId: (id) => bind.setSessionId(id),
    replace: (state, version) => bind.setState(state, version),
    emit: (emission) => bind.emit(emission),
    warn: (topic, detail) => {
      console.warn(`RemoteSessionView: ${topic}`, detail)
    },
    reconnected: () => bind.onReconnected(),
    resetReadMark: () => bind.resetReadMark(),
    advanceWaterMark: (patch) => bind.advanceWaterMark(patch),
  }
}

export function wireRemoteHistorySync(
  pipe: SessionPipe,
  reader: FrameReader,
  binding: RemoteHistoryPortBinding,
  sleep: (ms: number) => Promise<void>,
): HistorySync {
  const history = new HistorySync(createRemoteHistoryPort(binding), pipe, sleep)
  reader.onReconnected = (snapshot, opening) => {
    const frame = opening ?? { state: snapshot }
    void history.handleReconnected(frame, reader.currentConnectionId)
  }
  return history
}
