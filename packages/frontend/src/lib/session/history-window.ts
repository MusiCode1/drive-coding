import {
  createInitialSessionState,
  type HistoryPage,
  reduce,
  type SessionState,
  type SnapshotPayload,
  type WireSessionUpdate,
  wireSeqOf,
} from "@drive-coding/core/session"

export type HistoryWindow = HistoryPage & {
  watermark: number
}

export function defaultWindow(watermark: number): HistoryWindow {
  return { firstSeq: null, lastSeq: null, hasMore: false, watermark }
}

export function windowFromPayload(watermark: number, page?: HistoryPage): HistoryWindow {
  if (!page) {
    return defaultWindow(watermark)
  }
  return { ...page, watermark }
}

export function foldPage(metaState: SessionState, payload: SnapshotPayload): SessionState {
  let state = metaState
  for (const update of payload.updates) {
    state = reduce(state, update).state
  }
  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId.length > 0
      ? payload.sessionId
      : state.sessionId
  return { ...state, sessionId, version: payload.version }
}

export function mergeOlder(
  state: SessionState,
  window: HistoryWindow,
  payload: SnapshotPayload,
): { state: SessionState; window: HistoryWindow } | { conflict: true } {
  const page = payload.page
  if (page?.firstSeq == null || page.lastSeq == null || page.lastSeq + 1 !== window.firstSeq) {
    return { conflict: true }
  }
  const { messages } = foldPage(createInitialSessionState({ sessionId: state.sessionId }), payload)
  return {
    state: { ...state, messages: [...messages, ...state.messages] },
    window: { ...window, firstSeq: page.firstSeq, hasMore: page.hasMore },
  }
}

export function isOutsideWindow(seq: number | null, window: HistoryWindow): boolean {
  if (seq === null || window.firstSeq === null) return false
  return seq < window.firstSeq
}

export function seqFromUpdate(update: WireSessionUpdate): number | null {
  const seq = wireSeqOf(update)
  return seq === undefined ? null : seq
}
