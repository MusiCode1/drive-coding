/**
 * session-history-api.ts — GET /api/sessions/:cliKind/:acpSessionId.
 *
 * Asks the backend's history store whether a session exists and where it ran, which
 * `session/list` cannot answer without a live host.
 *
 * 🔑 A 404 is an **answer**, not a failure: it means "no row here". It is returned as
 * `undefined` rather than thrown, so the caller can tell "nothing to resume" apart from
 * "the lookup broke". A row missing here does not prove the CLI forgot the session.
 */

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { beUrl } from "$lib/util/be-url"

const SESSION_LOOKUP_TIMEOUT_MS = 10000

export type SessionHistoryRow = {
  cliKind: string
  acpSessionId: string
  cwd: string
  lastSeenAt: number
  turns: number
  lastTitle?: string
}

export async function fetchSessionHistoryRow(
  cliKind: string,
  acpSessionId: string,
  signal?: AbortSignal,
): Promise<SessionHistoryRow | undefined> {
  const path = `/api/sessions/${encodeURIComponent(cliKind)}/${encodeURIComponent(acpSessionId)}`
  const res = await withTimeout(
    (s) => fetch(beUrl(path), { signal: s }),
    SESSION_LOOKUP_TIMEOUT_MS,
    {
      signal,
      label: "fetchSessionHistoryRow",
    },
  )
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`fetchSessionHistoryRow failed: ${res.status}`)
  const body = (await res.json()) as { session: SessionHistoryRow }
  return body.session
}
