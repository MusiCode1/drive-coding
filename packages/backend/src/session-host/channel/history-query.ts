import { clampPageBytes, type StateToSessionUpdatesOptions } from "@drive-coding/core/session"

export type HistoryQueryOk = {
  ok: true
  opts: StateToSessionUpdatesOptions
}

export type HistoryQueryErr = {
  ok: false
  status: 400
  body: Record<string, unknown>
}

export type HistoryQueryResult = HistoryQueryOk | HistoryQueryErr

/** Pure L1 parser for GET /api/agents/:id/history query params. */
export function parseHistoryQuery(get: (key: string) => string | undefined): HistoryQueryResult {
  const tail = get("tail")
  const beforeRaw = get("before")
  const fromMessage = get("fromMessage")
  const maxBytesRaw = get("maxBytes")

  if (tail !== undefined && tail !== "1") {
    return { ok: false, status: 400, body: { error: "tail must be 1 when set" } }
  }
  const hasTail = tail === "1"
  const hasBefore = beforeRaw !== undefined
  const hasFrom = fromMessage !== undefined && fromMessage !== ""

  if (hasTail && (hasBefore || hasFrom)) {
    return { ok: false, status: 400, body: { error: "tail conflicts with before or fromMessage" } }
  }
  if (hasBefore && hasFrom) {
    return { ok: false, status: 400, body: { error: "before conflicts with fromMessage" } }
  }

  if ((hasTail || hasBefore) && maxBytesRaw === undefined) {
    return { ok: false, status: 400, body: { error: "maxBytes is required with tail or before" } }
  }

  if (maxBytesRaw !== undefined && !hasTail && !hasBefore) {
    return { ok: false, status: 400, body: { error: "maxBytes requires tail or before" } }
  }

  if (maxBytesRaw !== undefined) {
    const maxBytes = Number(maxBytesRaw)
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      return { ok: false, status: 400, body: { error: "maxBytes must be a positive number" } }
    }
    const clamped = clampPageBytes(maxBytes)
    if (hasTail) {
      return { ok: true, opts: { range: { tail: true, maxBytes: clamped } } }
    }
    if (hasBefore) {
      const before = Number(beforeRaw)
      if (!Number.isFinite(before) || before < 0) {
        return { ok: false, status: 400, body: { error: "before must be a non-negative seq" } }
      }
      return { ok: true, opts: { range: { before, maxBytes: clamped } } }
    }
  }

  if (hasFrom) {
    return { ok: true, opts: { fromMessage } }
  }

  return { ok: true, opts: {} }
}
