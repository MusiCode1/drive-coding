import type { ChannelResponse } from "@drive-coding/core/session"
import { HISTORY_PAGE_BYTES_DEFAULT, type SnapshotPayload } from "@drive-coding/core/session"
import type { HistorySyncPort } from "./history-sync-port"
import { foldPage, windowFromPayload } from "./history-window"
import type { OpeningFrame } from "./wire/frame-decode"
import type { HistoryPipe } from "./wire/pipe"

export type SettledGet = { ok: true; res: ChannelResponse } | { ok: false; err: unknown }

export function settleGet(promise: Promise<ChannelResponse>): Promise<SettledGet> {
  return promise
    .then((res) => ({ ok: true as const, res }))
    .catch((err: unknown) => ({ ok: false as const, err }))
}

export function parseHistoryBody(body: unknown): SnapshotPayload | null {
  if (typeof body !== "object" || body === null) return null
  const payload = body as SnapshotPayload
  if (!Array.isArray(payload.updates) || typeof payload.version !== "number") return null
  return payload
}

export type OpenResult =
  | {
      ok: true
      watermark: number
      adoptedSessionId?: string
      page?: SnapshotPayload["page"]
    }
  | { ok: false; reason: "no-meta" | "get-failed" | "invalid-page" }

export async function applyOpeningGet(
  opening: OpeningFrame,
  settled: SettledGet,
  sentBeforeOpen: boolean,
  port: HistorySyncPort,
  history: HistoryPipe,
  signal: AbortSignal,
  emitHistory: (tag: "tail" | "full", watermark: number, page?: SnapshotPayload["page"]) => void,
): Promise<OpenResult> {
  if (opening.historyOmitted === undefined) {
    return { ok: true, watermark: opening.state.version, page: undefined }
  }

  if (!settled.ok) {
    return { ok: false, reason: "get-failed" }
  }

  const { status, body } = settled.res
  if (status === 404 && sentBeforeOpen) {
    const retry = settleGet(
      history.get({ tail: true, maxBytes: HISTORY_PAGE_BYTES_DEFAULT }, signal),
    )
    const again = await retry
    return applyOpeningGet(opening, again, false, port, history, signal, emitHistory)
  }
  if (status !== 200) {
    return { ok: false, reason: "get-failed" }
  }

  const page = parseHistoryBody(body)
  if (!page) {
    return { ok: false, reason: "invalid-page" }
  }

  const S = opening.state.version
  const V = page.version
  if (V >= S) {
    const folded = foldPage(opening.state, page)
    const adopted =
      page.sessionId && page.sessionId !== opening.state.sessionId ? page.sessionId : undefined
    port.replace(folded, V)
    if (adopted) port.setSessionId(adopted)
    warnMissingPage(port, page)
    emitHistory("tail", V, page.page)
    return { ok: true, watermark: V, adoptedSessionId: adopted, page: page.page }
  }

  const tail = settleGet(history.get({ tail: true, maxBytes: HISTORY_PAGE_BYTES_DEFAULT }, signal))
  const second = await tail
  if (!second.ok || second.res.status !== 200) {
    return { ok: false, reason: "get-failed" }
  }
  const page2 = parseHistoryBody(second.res.body)
  if (!page2) return { ok: false, reason: "invalid-page" }
  const folded = foldPage(opening.state, page2)
  port.replace(folded, page2.version)
  warnMissingPage(port, page2)
  emitHistory("tail", page2.version, page2.page)
  return { ok: true, watermark: page2.version, page: page2.page }
}

export function warnMissingPage(
  port: Pick<HistorySyncPort, "warn">,
  payload: SnapshotPayload,
): void {
  if (payload.page === undefined) {
    port.warn("history-page-missing", {})
  }
}

export function buildWindowFromPayload(watermark: number, page?: SnapshotPayload["page"]) {
  if (!page) {
    return windowFromPayload(watermark, { firstSeq: null, lastSeq: null, hasMore: false })
  }
  return windowFromPayload(watermark, page)
}
