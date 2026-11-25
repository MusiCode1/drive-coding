import { runReloadTail } from "./history-reload"
import { applyEmitHistory, emitHistoryState, type HistoryEmitCtx } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import type { HistoryGate } from "./history-drain"
import type { HistoryWindow } from "./history-window"
import type { HistoryPipe } from "./wire/pipe"

export async function triggerHistoryReload(opts: {
  port: HistorySyncPort
  history: HistoryPipe
  gate: HistoryGate
  signal: AbortSignal
  sleep: (ms: number) => Promise<void>
  emitCtx: () => HistoryEmitCtx
  setWindow: (w: HistoryWindow) => void
  setReloading: (v: boolean) => void
  setError: (e: string | null) => void
  stampGen: () => number
  currentGen: () => number
  tag: "reload" | "reset"
}): Promise<void> {
  const {
    port,
    history,
    gate,
    signal,
    sleep,
    emitCtx,
    setWindow,
    setReloading,
    setError,
    stampGen,
    currentGen,
    tag,
  } = opts
  gate.close()
  setReloading(true)
  emitHistoryState(port, emitCtx())
  const gen = stampGen()
  const ok = await runReloadTail(
    port,
    history,
    signal,
    sleep,
    (t, watermark, page) => {
      setWindow(applyEmitHistory(port, emitCtx(), t, watermark, page))
    },
    tag,
  )
  if (gen !== currentGen()) return
  setReloading(false)
  setError(ok ? null : "history reload failed — retry")
  ok ? gate.open() : gate.markFailed()
  emitHistoryState(port, emitCtx())
}