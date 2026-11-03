/**
 * resume-deep-link.ts — the `/chat/<cli>/<sessionId>/resume` landing flow.
 *
 * Kept out of the route for the reason the FE golden rules give: a `.svelte` route should
 * render a decision, not make one. It also means the phase machine is testable without a
 * router, and the routes layer stays inside its line budget.
 *
 * `?cwd=` is **optional** here, unlike `/new`, because the history row usually knows the
 * folder. When present it wins: a session the CLI remembers but this backend never hosted
 * has no row, and the link is then the only source. Classification is shared with `/new`,
 * so a percent-encoded path is rejected the same way.
 */

import { env } from "$env/dynamic/public"
import { fetchServerOptions } from "$lib/adapters/options"
import { readSessionTransport } from "$lib/session/session-transport-read"
import { sessionPathWithTransport } from "$lib/session/session-url"
import { classifyDeepLinkCwd, joinHomeDir } from "$lib/util/deep-link-cwd"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"
import { resumeSession } from "./resume-session"

export type ResumePhase =
  | "starting"
  | "needs-takeover"
  | "unknown-cli"
  | "home-dir-failed"
  | "not-in-history"
  | "failed"

export type ResumeDeepLinkResult = { phase: ResumePhase } | { phase: "connected"; target: string }

export async function runResumeDeepLink(params: {
  cliKind: string
  sessionId: string
  rawCwd: string | null
  takeover: boolean
  session: AgentSession
  settings: Settings
  cliAvailability: { ready: Promise<unknown>; registry: readonly string[] }
}): Promise<ResumeDeepLinkResult> {
  const { cliKind, sessionId, rawCwd, takeover, session, settings, cliAvailability } = params

  await cliAvailability.ready
  if (!cliAvailability.registry.includes(cliKind)) return { phase: "unknown-cli" }

  let cwdOverride: string | null = null
  const classified = classifyDeepLinkCwd(rawCwd)
  if (classified.kind === "absolute") {
    cwdOverride = classified.cwd
  } else if (classified.kind === "relative") {
    try {
      const { homeDir } = await fetchServerOptions()
      cwdOverride = joinHomeDir(homeDir, classified.relative)
    } catch {
      return { phase: "home-dir-failed" }
    }
  }

  if (session.status !== "idle" && session.sessionId !== sessionId) {
    await session.leaveRunning()
  }

  const outcome = await resumeSession({
    cliKind,
    sessionId,
    cwdOverride,
    session,
    settings,
    confirmedTakeover: takeover,
  })

  if (outcome === "needs-takeover") return { phase: "needs-takeover" }
  if (outcome === "not-in-history") return { phase: "not-in-history" }
  if (outcome === "error") return { phase: "failed" }

  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })
  return {
    phase: "connected",
    target: sessionPathWithTransport(cliKind, session.sessionId ?? sessionId, transport),
  }
}
