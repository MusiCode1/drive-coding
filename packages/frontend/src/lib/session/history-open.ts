import type { ChannelResponse, SnapshotPayload } from "@drive-coding/core/session"

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

export function historyPage(result: SettledGet): SnapshotPayload | null {
  return result.ok && result.res.status === 200 ? parseHistoryBody(result.res.body) : null
}

export function gone(result: SettledGet): boolean {
  return result.ok && result.res.status === 404
}

export const HISTORY_OPEN_ERROR = "RemoteSessionView: history tail fetch failed"
