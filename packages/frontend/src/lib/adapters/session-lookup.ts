/**
 * session-lookup.ts — GET /api/sessions/:cliKind/:sessionId for cold session URL entry.
 */

import { beUrl } from "$lib/util/be-url"

export type SessionCwdLookup = { cwd: string; lastSeenAt: number }

export async function findSessionCwd(
  cliKind: string,
  sessionId: string,
): Promise<SessionCwdLookup | null> {
  const res = await fetch(
    beUrl(`/api/sessions/${encodeURIComponent(cliKind)}/${encodeURIComponent(sessionId)}`),
  )
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`findSessionCwd failed: ${res.status} ${body}`)
  }
  return (await res.json()) as SessionCwdLookup
}
