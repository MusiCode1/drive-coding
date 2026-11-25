import { gone, HISTORY_OPEN_ERROR, historyPage, type SettledGet } from "./history-open"
import { fetchTailWithRetries } from "./history-reload"
import { applyEmitHistory, type HistoryEmitCtx } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import { defaultWindow, foldPage, type HistoryWindow } from "./history-window"
import { snapshotResetPatch } from "./remote-session-stream"
import type { OpeningFrame } from "./wire/frame-decode"
import type { HistoryPipe } from "./wire/pipe"

export type FinishOpenCtx = {
  port: HistorySyncPort
  history: HistoryPipe
  sleep: (ms: number) => Promise<void>
  controller: AbortController
  pendingGet: Promise<SettledGet>
  emitCtx: () => HistoryEmitCtx
  setWindow: (w: HistoryWindow) => void
}

export async function finishHistoryOpen(opening: OpeningFrame, ctx: FinishOpenCtx): Promise<void> {
  if (!opening.historyOmitted) {
    ctx.controller.abort()
    ctx.setWindow(defaultWindow(opening.state.version))
    if (opening.state.messages.length > 0) {
      ctx.port.emit({ patches: [snapshotResetPatch(opening.state)], updates: [], history: "tail" })
    }
    return
  }

  const { signal } = ctx.controller
  const first = await ctx.pendingGet
  signal.throwIfAborted()
  let page = historyPage(first)
  if (!page || page.version < opening.state.version) {
    // A pre-opening 404 or an older page requires another GET as soon as the opening arrives.
    if (!gone(first) && !page) await ctx.sleep(1000)
    page = await fetchTailWithRetries(ctx.history, signal, 2, opening.state.version, (ms) =>
      ctx.sleep(ms * 2),
    )
  }
  signal.throwIfAborted()
  if (!page) throw new Error(HISTORY_OPEN_ERROR)

  ctx.port.replace(foldPage(opening.state, page), page.version)
  ctx.setWindow(applyEmitHistory(ctx.port, ctx.emitCtx(), "tail", page.version, page.page))
}
