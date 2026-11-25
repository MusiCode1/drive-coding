import { applyOpeningGet, buildWindowFromPayload, type SettledGet } from "./history-open"
import { fetchTailWithRetries, openAttemptLimit } from "./history-reload"
import type { HistoryEmitCtx } from "./history-sync-emit"
import { applyEmitHistory } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import type { HistoryWindow } from "./history-window"
import { snapshotResetPatch } from "./remote-session-stream"
import type { OpeningFrame } from "./wire/frame-decode"
import type { FrameReader } from "./wire/frame-reader"
import type { HistoryPipe } from "./wire/pipe"

export type FinishOpenCtx = {
  port: HistorySyncPort
  history: HistoryPipe
  reader: FrameReader
  sleep: (ms: number) => Promise<void>
  signal: AbortSignal
  pendingGet: Promise<SettledGet> | null
  emitCtx: () => HistoryEmitCtx
  setWindow: (w: HistoryWindow) => void
  setMetaMode: (v: boolean) => void
}

export async function finishHistoryOpen(opening: OpeningFrame, ctx: FinishOpenCtx): Promise<void> {
  ctx.setMetaMode(opening.historyOmitted !== undefined)
  const settled = (await ctx.pendingGet) ?? { ok: false as const, err: new Error("no get") }
  const emit = (
    tag: Parameters<typeof applyEmitHistory>[2],
    watermark: number,
    page?: Parameters<typeof applyEmitHistory>[4],
  ) => {
    ctx.setWindow(applyEmitHistory(ctx.port, ctx.emitCtx(), tag, watermark, page))
  }
  let result = await applyOpeningGet(
    opening,
    settled,
    true,
    ctx.port,
    ctx.history,
    ctx.signal,
    emit,
  )

  if (!result.ok && opening.historyOmitted !== undefined) {
    for (let attempt = 1; attempt < openAttemptLimit() && !result.ok; attempt++) {
      const retry = await fetchTailWithRetries(ctx.history, ctx.signal, 1, ctx.sleep)
      result = await applyOpeningGet(opening, retry, false, ctx.port, ctx.history, ctx.signal, emit)
    }
  }

  if (!result.ok && opening.historyOmitted !== undefined) {
    ctx.reader.close()
    throw new Error("RemoteSessionView: history tail fetch failed")
  }

  if (opening.historyOmitted === undefined && opening.state.messages.length > 0) {
    ctx.port.emit({ patches: [snapshotResetPatch(opening.state)], updates: [] })
  }

  if (result.ok) {
    ctx.setWindow(buildWindowFromPayload(result.watermark, result.page))
  }
}
