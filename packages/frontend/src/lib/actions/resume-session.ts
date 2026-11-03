/**
 * resume-session.ts — bring an existing session back up, with or without a live host.
 *
 * `openSessionUrl` can only attach to a session some live agent already hosts. When no
 * host of that CLI is up it answers `not-found`, and until now that was the end of the
 * road: ACP `session/load` needs a connection, and a connection needs a `cwd` that only
 * the dead session knew.
 *
 * ─── Live first, cold second ─────────────────────────────────────────────────
 *
 * This deliberately *starts* by calling `openSessionUrl`, so the live-host, warm-switch
 * and takeover paths stay in one place instead of being reimplemented here. Only its
 * `not-found` falls through to the cold path below.
 *
 * `error` does **not** fall through. It means an attach or a `listSessions` against a
 * live host failed, and spawning a second host on top of that is more likely to
 * duplicate the agent than to recover it.
 *
 * ─── Where `cwd` comes from ──────────────────────────────────────────────────
 *
 * The history row, or `?cwd=` when the caller supplies it. The override wins: a session
 * the CLI knows but we never hosted has no row, and the link is then the only source.
 */

import { env } from "$env/dynamic/public"
import { fetchSessionHistoryRow } from "$lib/adapters/session-history-api"
import { readSessionTransport } from "$lib/session/session-transport-read"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import type { Settings } from "$lib/view-models/settings.svelte"
import { openSessionUrl } from "./open-session-url"

export type ResumeOutcome =
  | "connected"
  | "needs-takeover"
  /** No live host *and* no history row — there is nothing to resume from. */
  | "not-in-history"
  | "error"

function connectionFailed(session: AgentSession): boolean {
  return session.status !== "connected" || session.error !== null
}

export async function resumeSession(params: {
  cliKind: string
  sessionId: string
  /** From `?cwd=`, already resolved to an absolute path by the caller. */
  cwdOverride?: string | null
  session: AgentSession
  settings: Settings
  confirmedTakeover?: boolean
}): Promise<ResumeOutcome> {
  const { cliKind, sessionId, session, settings, confirmedTakeover = false } = params

  const viaLiveHost = await openSessionUrl({
    cliKind,
    sessionId,
    session,
    settings,
    confirmedTakeover,
  })
  if (viaLiveHost !== "not-found") return viaLiveHost

  let cwd = params.cwdOverride ?? null
  if (cwd === null) {
    let row: Awaited<ReturnType<typeof fetchSessionHistoryRow>>
    try {
      row = await fetchSessionHistoryRow(cliKind, sessionId)
    } catch (e) {
      session.error = formatAcpError(e)
      return "error"
    }
    if (row === undefined) return "not-in-history"
    cwd = row.cwd
  }

  settings.setCliKind(cliKind)
  settings.setLastCwd(cwd)

  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })

  // Spawn a host for that cwd. This opens a fresh ACP session as a side effect; the
  // switchSession below is what actually loads the one that was asked for.
  try {
    if (transport === "http") {
      await session.attachRemote({
        cwd,
        cliKind,
        systemPrompt: settings.getProjectPrompt(cwd),
      })
    } else {
      await session.attach({
        cwd,
        cliKind,
        systemPrompt: settings.getProjectPrompt(cwd),
      })
    }
  } catch (e) {
    session.error = formatAcpError(e)
    return "error"
  }
  if (connectionFailed(session)) return "error"

  // ACP session/load. A row can name a session the CLI has since deleted, and this is
  // where that shows up — the host is already alive, so the failure is the load's.
  try {
    await session.switchSession({ sessionId, cwd, cliKind })
  } catch (e) {
    session.error = formatAcpError(e)
    return "error"
  }
  if (connectionFailed(session)) return "error"

  return "connected"
}
