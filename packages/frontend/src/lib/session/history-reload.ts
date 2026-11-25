import { HISTORY_PAGE_BYTES_DEFAULT, type SnapshotPayload } from "@drive-coding/core/session"
import { gone, historyPage, settleGet } from "./history-open"
import type { OpeningFrame } from "./wire/frame-decode"
import type { HistoryPipe } from "./wire/pipe"
import { MAX_BACKOFF_MS } from "./wire/reader-liveness"

export function fetchTail(history: HistoryPipe, signal: AbortSignal) {
  return settleGet(history.get({ tail: true, maxBytes: HISTORY_PAGE_BYTES_DEFAULT }, signal))
}

export async function fetchTailWithRetries(
  history: HistoryPipe,
  signal: AbortSignal,
  attempts: number,
  minVersion: number,
  sleep: (ms: number) => Promise<void>,
): Promise<SnapshotPayload | null> {
  let delay = 1000
  for (let i = 0; i < attempts && !signal.aborted; i++) {
    if (i > 0) {
      await sleep(delay)
      delay = Math.min(delay * 2, MAX_BACKOFF_MS)
      if (signal.aborted) break
    }
    const result = await fetchTail(history, signal)
    if (signal.aborted || gone(result)) return null
    const page = historyPage(result)
    if (page && page.version >= minVersion) return page
  }
  return null
}

export function shouldReloadOnReconnect(
  prevSessionId: string | null,
  opening: OpeningFrame,
  prevVersion: number,
): "reload" | "reset" | null {
  const { state, historyOmitted } = opening
  if (!historyOmitted) return null
  if (state.sessionId !== prevSessionId || state.version < prevVersion) return "reset"
  return state.version > prevVersion ? "reload" : null
}
