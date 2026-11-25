import type { SessionState, SnapshotPayload } from "@drive-coding/core/session"
import type { HistorySyncPort } from "./history-sync-port"
import { type HistoryWindow, windowFromPayload } from "./history-window"
import { snapshotResetPatch } from "./remote-session-stream"
import type { ViewEmission } from "./session-view"

export type HistoryEmitCtx = {
  window: HistoryWindow
  error: string | null
  reloading: boolean
}

export function applyEmitHistory(
  port: HistorySyncPort,
  ctx: HistoryEmitCtx,
  tag: ViewEmission["history"],
  watermark: number,
  page?: SnapshotPayload["page"],
): HistoryWindow {
  const window = windowFromPayload(watermark, page)
  if (page === undefined && tag !== "full") port.warn("history-page-missing")
  const state = port.getState()
  const patches = state.messages.length > 0 || tag !== "tail" ? [snapshotResetPatch(state)] : []
  if (patches.length === 0 && !window.hasMore) return window
  port.emit({
    patches,
    updates: [],
    history: tag,
    historyState: { window, error: ctx.error, reloading: ctx.reloading },
  })
  return window
}

export function emitHistoryState(port: HistorySyncPort, ctx: HistoryEmitCtx): void {
  port.emit({
    patches: [],
    updates: [],
    historyState: { window: ctx.window, error: ctx.error, reloading: ctx.reloading },
  })
}

export function legacyReconnect(port: HistorySyncPort, snapshot: SessionState): void {
  const sessionChanged = snapshot.sessionId !== port.getSessionId()
  if (!sessionChanged && snapshot.version <= port.getLastVersion()) return
  port.replace(snapshot, snapshot.version)
  port.setSessionId(snapshot.sessionId)
  port.resetReadMark()
  port.emit({ patches: [snapshotResetPatch(snapshot)], updates: [] })
  port.reconnected()
}
