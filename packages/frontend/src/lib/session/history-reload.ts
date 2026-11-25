import { HISTORY_PAGE_BYTES_DEFAULT, type SnapshotPayload } from "@drive-coding/core/session"
import { applyOpeningGet, parseHistoryBody, type SettledGet, settleGet } from "./history-open"
import type { HistorySyncPort } from "./history-sync-port"
import { foldPage } from "./history-window"
import type { OpeningFrame } from "./wire/frame-decode"
import type { HistoryPipe } from "./wire/pipe"

const RELOAD_ATTEMPTS = 5
const OPEN_ATTEMPTS = 3

export function openAttemptLimit(): number {
  return OPEN_ATTEMPTS
}

export function reloadAttemptLimit(): number {
  return RELOAD_ATTEMPTS
}

export async function fetchTailWithRetries(
  history: HistoryPipe,
  signal: AbortSignal,
  attempts: number,
  sleep: (ms: number) => Promise<void>,
): Promise<SettledGet> {
  let delay = 1000
  for (let i = 0; i < attempts; i++) {
    const settled = await settleGet(
      history.get({ tail: true, maxBytes: HISTORY_PAGE_BYTES_DEFAULT }, signal),
    )
    if (settled.ok && settled.res.status === 200) return settled
    if (settled.ok && settled.res.status === 404) return settled
    if (i + 1 >= attempts) return settled
    await sleep(delay)
    delay = Math.min(delay * 2, 30_000)
  }
  return { ok: false, err: new Error("history fetch exhausted") }
}

export type ReloadReason = "version-up" | "version-down" | "session-changed" | "reset"

export function shouldReloadOnReconnect(
  prevSessionId: string | null,
  opening: OpeningFrame,
  prevVersion: number,
): ReloadReason | null {
  const snap = opening.state
  if (opening.historyOmitted === undefined) return null
  if (snap.sessionId !== prevSessionId) return "session-changed"
  if (snap.version > prevVersion) return "version-up"
  if (snap.version < prevVersion) return "version-down"
  return null
}

export async function runReloadTail(
  port: HistorySyncPort,
  history: HistoryPipe,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void>,
  emitHistory: (tag: "reload" | "reset", watermark: number, page?: SnapshotPayload["page"]) => void,
  tag: "reload" | "reset",
): Promise<boolean> {
  const settled = await fetchTailWithRetries(history, signal, RELOAD_ATTEMPTS, sleep)
  if (!settled.ok || settled.res.status !== 200) return false
  const page = parseHistoryBody(settled.res.body)
  if (!page) return false
  const folded = foldPage(port.getState(), page)
  port.replace(folded, page.version)
  emitHistory(tag, page.version, page.page)
  return true
}
