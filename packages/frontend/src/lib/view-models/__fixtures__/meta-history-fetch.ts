import {
  type SessionState,
  type SnapshotPayload,
  snapshotFrame,
  snapshotPayload,
} from "@drive-coding/core/session"

const TAIL = { tail: true as const, maxBytes: 262_144 }

export function historyTailResponse(
  state: SessionState,
  opts?: { history?: "omit" },
): SnapshotPayload {
  return snapshotPayload(state, undefined, opts?.history ? { history: "omit" } : { range: TAIL })
}

export function withHistoryTail(
  baseUrl: string,
  state: SessionState,
  next: (url: string, init?: RequestInit) => Promise<Response>,
  opts?: { history?: "omit" },
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const path = new URL(url, baseUrl).pathname
    if (path.endsWith("/history")) {
      return Response.json(historyTailResponse(state, opts), { status: 200 })
    }
    return next(url, init)
  }
}

export function metaSnapshotFrame(state: SessionState) {
  return snapshotFrame(state, undefined, "meta")
}
