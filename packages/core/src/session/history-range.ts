/**
 * Byte-budget page selection for session history (pure).
 * slice fast-session-open-1 — C2
 */
import type { SessionMessage, SessionState } from "./types"

export const HISTORY_PAGE_BYTES_DEFAULT = 256 * 1024
export const HISTORY_PAGE_BYTES_MAX = 1024 * 1024

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length
}

export function clampPageBytes(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return HISTORY_PAGE_BYTES_DEFAULT
  return Math.min(Math.floor(n), HISTORY_PAGE_BYTES_MAX)
}

export type HistoryPage = {
  firstSeq: number | null
  lastSeq: number | null
  hasMore: boolean
}

export type HistoryRange = { tail: true; maxBytes: number } | { before: number; maxBytes: number }

function seqOfMessage(m: SessionMessage): number | null {
  const match = /^m_(\d+)$/.exec(m.id)
  return match ? Number(match[1]) : null
}

function pageMeta(messages: SessionMessage[], start: number, end: number): HistoryPage {
  if (start >= end || messages.length === 0) {
    return { firstSeq: null, lastSeq: null, hasMore: start > 0 }
  }
  const slice = messages.slice(start, end)
  const first = seqOfMessage(slice[0] as SessionMessage)
  const last = seqOfMessage(slice[slice.length - 1] as SessionMessage)
  return { firstSeq: first, lastSeq: last, hasMore: start > 0 }
}

/** F1: page message bytes ≤ maxBytes unless the page is a single message. */
export function assertHistoryPageByteBudget(
  messages: SessionMessage[],
  maxBytes: number,
  sizeOf: (m: SessionMessage) => number,
): boolean {
  if (messages.length === 0) return true
  const bytes = messages.reduce((acc, m) => acc + sizeOf(m), 0)
  return messages.length === 1 || bytes <= maxBytes
}

function sliceTail(
  messages: SessionMessage[],
  maxBytes: number,
  sizeOf: (m: SessionMessage) => number,
): { start: number; end: number } {
  if (messages.length === 0) return { start: 0, end: 0 }
  let start = messages.length - 1
  let bytes = sizeOf(messages[start] as SessionMessage)
  for (let i = start - 1; i >= 0; i--) {
    const m = messages[i]
    if (m === undefined) break
    const sz = sizeOf(m)
    if (bytes + sz > maxBytes) break
    bytes += sz
    start = i
  }
  return { start, end: messages.length }
}

export function selectRange(
  state: SessionState,
  range: HistoryRange,
  sizeOf: (m: SessionMessage) => number,
):
  | { ok: true; start: number; end: number; page: HistoryPage }
  | { ok: false; reason: "unknown-before" } {
  const { messages } = state
  const maxBytes = clampPageBytes("tail" in range ? range.maxBytes : range.maxBytes)

  if ("before" in range) {
    const anchor = range.before
    let idx = messages.findIndex((m) => seqOfMessage(m) === anchor)
    if (idx === -1) idx = messages.findIndex((m) => m.id === `m_${anchor}`)
    if (idx === -1) return { ok: false, reason: "unknown-before" }
    if (idx === 0) {
      return {
        ok: true,
        start: 0,
        end: 0,
        page: { firstSeq: null, lastSeq: null, hasMore: false },
      }
    }
    const prefix = messages.slice(0, idx)
    const { start } = sliceTail(prefix, maxBytes, sizeOf)
    return { ok: true, start, end: idx, page: pageMeta(messages, start, idx) }
  }

  const { start, end } = sliceTail(messages, maxBytes, sizeOf)
  return { ok: true, start, end, page: pageMeta(messages, start, end) }
}
