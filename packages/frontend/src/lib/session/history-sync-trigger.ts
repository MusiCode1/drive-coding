import type { SessionState } from "@drive-coding/core/session"
import type { HistoryGate } from "./history-drain"
import { type HistoryPreserve, preserveHistory } from "./history-preserve"
import { fetchTailWithRetries } from "./history-reload"
import { applyEmitHistory, emitHistoryState, type HistoryEmitCtx } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import { foldPage, type HistoryWindow } from "./history-window"
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
  tag: "reload" | "reset"
  seed: SessionState
  preserve?: HistoryPreserve
  settleFloors: (before?: number) => void
}): Promise<boolean> {
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
    tag,
    seed,
    preserve,
    settleFloors,
  } = opts
  gate.close()
  setReloading(true)
  emitHistoryState(port, emitCtx())
  const page = await fetchTailWithRetries(history, signal, 5, seed.version, sleep)
  if (signal.aborted) return false
  setReloading(false)
  setError(page ? null : "history reload failed — retry")
  if (page) {
    const tail = foldPage({ ...seed, messages: [] }, page)
    const preserved = preserve && page.page && preserveHistory(preserve, tail, page.page)
    port.replace(preserved?.state ?? tail, page.version)
    settleFloors(preserved ? (page.page?.firstSeq ?? undefined) : undefined)
    setWindow(applyEmitHistory(port, emitCtx(), tag, page.version, preserved?.page ?? page.page))
    gate.open()
  } else {
    gate.markFailed()
  }
  emitHistoryState(port, emitCtx())
  return page !== null
}
