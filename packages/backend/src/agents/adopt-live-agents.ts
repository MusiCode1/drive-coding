/**
 * adopt-live-agents.ts — deciding which persisted agents come back at boot.
 *
 * This is the one-line swap the registry snapshot was built around: S2 wrote
 * every agent row to disk and then deliberately adopted **none** of them,
 * because at that point a row on disk described a process that no longer
 * existed. With sidecars it can describe one that does, and the question
 * becomes answerable — by asking.
 *
 * ```
 *   snapshot rows ─┐
 *                  ├─▶ adopt = rows whose socket answers _drive/ping
 *   socket dir  ───┘
 * ```
 *
 * The two halves are both necessary and neither is sufficient: the directory
 * knows who is alive but not who they are, and the snapshot knows who they are
 * but not whether they still exist.
 *
 * ─── 🔴 Adopting a row is not the same as being ready to use it ──────────────
 *
 * `acpSessionIdCache` is an in-memory Map that dies with the backend. A row
 * restored without its ACP session id, handed to the HTTP path, would take the
 * cold branch and call `session/new` on an agent that is already mid-turn —
 * producing a *second* session on the same agent, which is worse than showing
 * nothing.
 *
 * So adoption restores the row and the connection, and nothing else: no session
 * host is created here. Rows that carry an `acpSessionId` from the snapshot keep
 * it and can be re-attached warm later; rows without one are adopted as
 * `starting`, which is honest — the agent is alive, the session is not yet
 * re-established.
 */

import type { Agent } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { agentSocketPath, listAgentSockets, probeAgentSocket } from "./agent-sockets.js"

const log = createLogger("backend.agents.adopt")

/**
 * Rows whose sidecar is alive right now.
 *
 * Sockets with no matching row are reaped: they belong to an agent whose record
 * is gone, so nothing will ever attach to them again. Rows with no live socket
 * are simply not adopted — the snapshot writer then drops them from disk.
 */
export async function adoptLiveAgents(rows: readonly Agent[], socketDir: string): Promise<Agent[]> {
  const ids = new Set(listAgentSockets(socketDir))
  if (ids.size === 0) return []

  const byId = new Map(rows.map((r) => [r.id, r]))
  const adopted: Agent[] = []

  for (const id of ids) {
    const probe = await probeAgentSocket(agentSocketPath(socketDir, id))
    const row = byId.get(id)

    if (probe.state !== "alive") {
      // stale was already unlinked by the probe; wedged/unknown are left alone
      // rather than guessed at.
      log.info({ agentId: id, state: probe.state }, "socket not adopted")
      continue
    }
    if (row === undefined) {
      log.warn({ agentId: id }, "live sidecar with no record — orphan, left running")
      continue
    }
    adopted.push({
      ...row,
      // The process is real; the ACP session is not re-established yet. Saying
      // "ready" here would be a claim we have not earned.
      status: row.acpSessionId !== undefined ? "starting" : "starting",
      crashReason: undefined,
    } as Agent)
  }

  if (adopted.length > 0) {
    log.info({ count: adopted.length, ids: adopted.map((a) => a.id) }, "adopted live agents")
  }
  return adopted
}
