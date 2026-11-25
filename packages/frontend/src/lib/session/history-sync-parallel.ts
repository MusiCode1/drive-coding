import { HISTORY_PAGE_BYTES_DEFAULT } from "@drive-coding/core/session"
import { settleGet, type SettledGet } from "./history-open"
import type { SessionPipe } from "./wire/pipe"

export function startParallelHistoryGet(pipe: SessionPipe, signal: AbortSignal): Promise<SettledGet> {
  return settleGet(pipe.history.get({ tail: true, maxBytes: HISTORY_PAGE_BYTES_DEFAULT }, signal))
}