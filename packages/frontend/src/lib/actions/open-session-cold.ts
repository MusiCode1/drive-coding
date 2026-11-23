/**
 * open-session-cold.ts — cold URL entry when no live agent holds the session (slice fix-session-url-hijack).
 */

import { env } from "$env/dynamic/public"
import { findSessionCwd } from "$lib/adapters/session-lookup"
import { readSessionTransport } from "$lib/session/session-transport-read"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { formatAcpError } from "$lib/view-models/format-acp-error"
import type { Settings } from "$lib/view-models/settings.svelte"
import type { OpenSessionOutcome } from "./open-session-url.js"
import { connectionFailed } from "./session-connection.js"

export async function openSessionCold(params: {
  cliKind: string
  sessionId: string
  session: AgentSession
  settings: Settings
}): Promise<OpenSessionOutcome> {
  const { cliKind, sessionId, session, settings } = params

  let cwd: string
  try {
    const found = await findSessionCwd(cliKind, sessionId)
    if (found === null) return "not-found"
    cwd = found.cwd
  } catch (e) {
    session.error = formatAcpError(e)
    return "error"
  }

  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })

  if (transport === "http") {
    try {
      await session.attachRemote({
        cwd,
        cliKind,
        systemPrompt: settings.getProjectPrompt(cwd),
      })
    } catch (e) {
      session.error = formatAcpError(e)
      return "error"
    }

    if (connectionFailed(session)) return "error"

    try {
      await session.switchSession({ sessionId, cwd, cliKind })
    } catch (e) {
      session.error = formatAcpError(e)
    }

    if (session.error !== null || session.sessionId !== sessionId) {
      const err = session.error
      session.detach()
      session.error = err
      return "error"
    }
  } else {
    try {
      await session.loadSession({ sessionId, cwd, cliKind })
    } catch (e) {
      session.error = formatAcpError(e)
      return "error"
    }

    if (connectionFailed(session)) return "error"
  }

  return "connected"
}
