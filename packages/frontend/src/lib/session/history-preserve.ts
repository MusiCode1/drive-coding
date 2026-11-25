import type { HistoryPage, SessionMessage, SessionState } from "@drive-coding/core/session"
import type { HistoryWindow } from "./history-window"

export type HistoryPreserve = { state: SessionState; window: HistoryWindow }

function seq(message: SessionMessage): number {
  return /^m_\d+$/.test(message.id) ? Number(message.id.slice(2)) : Number.NaN
}

function sameBoundary(old: SessionMessage, fresh: SessionMessage): boolean {
  if (old.role !== fresh.role) return false
  if (old.role === "tool") {
    return fresh.role === "tool" && old.toolCall.toolCallId === fresh.toolCall.toolCallId
  }
  return old.messageId === null || old.messageId === fresh.messageId
}

export function preserveHistory(
  previous: HistoryPreserve,
  tail: SessionState,
  page: HistoryPage,
): { state: SessionState; page: HistoryPage } | undefined {
  const { state, window } = previous
  const { firstSeq } = page
  if (firstSeq === null || window.firstSeq === null) return
  const boundary = state.messages.at(-1)
  if (!boundary || !(firstSeq <= seq(boundary))) return
  const refreshed = tail.messages.find(({ id }) => id === boundary.id)
  if (!refreshed || !sameBoundary(boundary, refreshed)) return

  const prefix = state.messages.filter((message) => seq(message) < firstSeq)
  if (prefix.length === 0) return
  if (
    prefix.some(
      (message) =>
        message.role === "tool" &&
        (message.toolCall.status === "pending" || message.toolCall.status === "in_progress"),
    )
  )
    return
  if (state.turnState !== "idle") {
    const lastUser = state.messages.findLast(({ role }) => role === "user")
    if (!lastUser || prefix.some((message) => seq(message) >= seq(lastUser))) return
  }
  return {
    state: { ...tail, messages: [...prefix, ...tail.messages] },
    page: { ...page, firstSeq: window.firstSeq, hasMore: window.hasMore },
  }
}
