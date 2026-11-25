import type { SnapshotPayload } from "@drive-coding/core/session"
import type { HistoryGate } from "./history-drain"
import { settleGet } from "./history-open"
import { applyEmitHistory, emitHistoryState, type HistoryEmitCtx } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import type { HistoryWindow } from "./history-window"
import { foldPage } from "./history-window"
import type { ViewEmission } from "./session-view"
import type { HistoryPipe } from "./wire/pipe"

export async function loadFullHistory(opts: {
  port: HistorySyncPort
  history: HistoryPipe
  gate: HistoryGate
  signal: AbortSignal
  gen: number
  reloadGeneration: number
  emitCtx: () => HistoryEmitCtx
  setReloading: (v: boolean) => void
  setError: (e: string | null) => void
  setWindow: (w: HistoryWindow) => void
}): Promise<boolean> {
  const {
    port,
    history,
    gate,
    signal,
    gen,
    reloadGeneration,
    emitCtx,
    setReloading,
    setError,
    setWindow,
  } = opts
  gate.close()
  setReloading(true)
  emitHistoryState(port, emitCtx())
  const settled = await settleGet(history.get({ full: true }, signal))
  if (gen !== reloadGeneration) return false
  setReloading(false)
  if (!settled.ok || settled.res.status !== 200) {
    setError("history load failed")
    gate.markFailed()
    emitHistoryState(port, emitCtx())
    return false
  }
  const body = settled.res.body
  const payload = typeof body === "object" && body !== null ? (body as SnapshotPayload) : null
  if (!payload) {
    setError("history load failed")
    gate.markFailed()
    emitHistoryState(port, emitCtx())
    return false
  }
  const folded = foldPage(port.getState(), payload)
  port.replace(folded, payload.version)
  setWindow(applyEmitHistory(port, emitCtx(), "full", payload.version, payload.page))
  setError(null)
  gate.open()
  emitHistoryState(port, emitCtx())
  return true
}

export type EmitTag = NonNullable<ViewEmission["history"]>
