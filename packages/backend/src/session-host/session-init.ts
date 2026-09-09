/**
 * session-init.ts — opening the ACP session for a freshly created host.
 *
 * Two ways in, and one of them can fail in a way that used to be fatal:
 *
 *   warm  `session/load` with a session id we remember — restores the transcript
 *   cold  `session/new` — a fresh session
 *
 * ─── 🔴 Why the fallback exists ──────────────────────────────────────────────
 *
 * A failed `loadSession` used to propagate, host creation was rolled back, and
 * the agent became **unopenable** — while its process was alive and healthy.
 * The user sees an agent in the list that errors every time they click it, and
 * nothing short of deleting it helps.
 *
 * That path was mostly unreachable before sidecars: `acpSessionIdCache` died
 * with the backend, so a restored agent always took the cold branch. Seeding
 * that cache from the persisted rows is what made warm reattach work — and, in
 * the same stroke, made this failure reachable. A session id can be stale for
 * ordinary reasons: the CLI restarted internally, the session expired, the
 * adapter was upgraded underneath us.
 *
 * So a warm failure degrades to a cold start instead of killing the agent. The
 * transcript is lost, which is worth one loud warning — and is strictly better
 * than an agent nobody can open.
 */

import { createLogger } from "@drive-coding/core/log"

const log = createLogger("backend.session-host.init")

type SessionOpener = {
  loadSession(opts: { cwd: string; sessionId: string } & Record<string, unknown>): Promise<unknown>
  newSession(opts: { cwd: string } & Record<string, unknown>): Promise<unknown>
}

export type SessionInitOutcome = "warm" | "cold" | "cold-after-warm-failed"

/**
 * Open a session, preferring warm reattach. Never throws for a warm failure —
 * only a cold failure is fatal, because at that point there is no session at all.
 */
export async function initSession(
  host: SessionOpener,
  base: { cwd: string } & Record<string, unknown>,
  acpSessionId: string | undefined,
  agentId: string,
): Promise<SessionInitOutcome> {
  if (acpSessionId === undefined) {
    await host.newSession(base)
    return "cold"
  }
  try {
    await host.loadSession({ ...base, sessionId: acpSessionId })
    return "warm"
  } catch (err) {
    log.warn(
      { err, agentId, acpSessionId },
      "session/load failed — starting a fresh session; the previous transcript is not recoverable",
    )
    await host.newSession(base)
    return "cold-after-warm-failed"
  }
}
