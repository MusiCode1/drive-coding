/**
 * session-screen.ts — what `/chat/<cli>/<sessionId>` should render, in one call.
 *
 * The route used to do two awaits: resolve the URL, then look up a history row to decide
 * whether to offer resume. Both are IO, and IO belongs in this layer — the route's job is
 * to render the answer. Folding them into one call also keeps the adapter out of the
 * route's imports entirely.
 *
 * 🔑 The lookup is **fail-open**: an unreachable history store means no offer, never an
 * error screen. The user asked for a session that is not up; that a side query failed is
 * not their problem and must not change what they are told.
 */

import { type OpenSessionOutcome, openSessionUrl } from "$lib/actions/open-session-url"
import { fetchSessionHistoryRow, type SessionHistoryRow } from "$lib/adapters/session-history-api"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"

export type SessionScreen = {
  outcome: OpenSessionOutcome
  /** Set only when the session is not up *and* history knows where it ran. */
  resumable: SessionHistoryRow | null
}

export async function resolveSessionScreen(params: {
  cliKind: string
  sessionId: string
  session: AgentSession
  settings: Settings
  confirmedTakeover?: boolean
}): Promise<SessionScreen> {
  const outcome = await openSessionUrl(params)
  if (outcome !== "not-found") return { outcome, resumable: null }
  try {
    const row = await fetchSessionHistoryRow(params.cliKind, params.sessionId)
    return { outcome, resumable: row ?? null }
  } catch {
    return { outcome, resumable: null }
  }
}
