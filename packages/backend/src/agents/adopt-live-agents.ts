/**
 * adopt-live-agents.ts — deciding which agents come back at boot.
 *
 * ```
 *   snapshot rows ─┐
 *                  ├─▶ adopt = whoever answers _drive/ping
 *   socket dir  ───┘
 * ```
 *
 * ─── 🔴 The directory leads, the snapshot follows ────────────────────────────
 *
 * The first version of this read the snapshot first and only then looked at the
 * sockets, which quietly inverted the design: with no rows it never scanned at
 * all, and a socket whose row was missing was ignored. Reproduced 2026-09-08 —
 * one boot where a probe missed was enough to delete the row, after which the
 * live agent could never be seen again by anything except `systemctl`.
 *
 * So the scan starts from the directory. A row supplies the details we keep
 * (roleLabel, acpSessionId, parentAgentId…); the sidecar's own meta file
 * supplies enough to rebuild one when the row is gone. Losing the snapshot is
 * now recoverable rather than terminal.
 *
 * ─── Adopting a row is not the same as being ready to use it ─────────────────
 *
 * A restored agent comes back as `starting`, never `ready`: the process is real,
 * but the ACP session has to be re-established before anything can be said about
 * it. The caller re-seeds the session id separately.
 */

import type { Agent } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import {
  type AgentSocketMeta,
  agentSocketPath,
  listAgentSockets,
  probeAgentSocket,
  readAgentMeta,
} from "./agent-sockets.js"

const log = createLogger("backend.agents.adopt")

export type AdoptionResult = {
  /** Agents confirmed alive — these go into the registry. */
  adopted: Agent[]
  /**
   * Rows we could not confirm but must not delete: their socket file is still
   * there, it just did not answer in time. Kept on disk, not made live.
   */
  retained: Agent[]
  /** Live sidecars rebuilt from their meta file because the row was gone. */
  recovered: string[]
}

/** Build a plausible row for a live sidecar whose record we lost. */
function rowFromMeta(meta: AgentSocketMeta): Agent {
  return {
    id: meta.agentId,
    cliKind: meta.cliKind,
    cwd: meta.cwd,
    modelOverride: null,
    status: "starting",
    createdAt: meta.startedAt,
    persistent: false,
  } as Agent
}

export async function adoptLiveAgents(
  rows: readonly Agent[],
  socketDir: string,
): Promise<AdoptionResult> {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ids = listAgentSockets(socketDir)
  const adopted: Agent[] = []
  const retained: Agent[] = []
  const recovered: string[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    seen.add(id)
    const probe = await probeAgentSocket(agentSocketPath(socketDir, id))
    const row = byId.get(id)

    if (probe.state === "stale") {
      // The probe already unlinked the corpse. Its row goes with it.
      log.info({ agentId: id }, "socket was an orphan file — reaped")
      continue
    }
    if (probe.state !== "alive") {
      // 🔴 Present but unconfirmed. Deleting the row here is what stranded a
      // live agent in the reproduction: dropping a record is immediate and
      // permanent, while adopting needs a success inside one second. Keep it.
      if (row !== undefined) retained.push(row)
      log.warn(
        { agentId: id, state: probe.state },
        "socket did not answer — row retained, not live",
      )
      continue
    }

    if (row !== undefined) {
      adopted.push({ ...row, status: "starting", crashReason: undefined } as Agent)
      continue
    }

    // Live, and we have no record of it. Before the meta file this was a dead
    // end; now the sidecar told us who it is.
    const meta = readAgentMeta(socketDir, id)
    if (meta === null) {
      log.warn({ agentId: id }, "live sidecar with neither record nor meta — left running")
      continue
    }
    recovered.push(id)
    adopted.push(rowFromMeta(meta))
    log.info({ agentId: id, cliKind: meta.cliKind }, "recovered a live sidecar from its meta file")
  }

  // Rows whose socket is not in the directory at all: the agent is genuinely
  // gone, and the row should stop being offered.
  for (const row of rows) {
    if (!seen.has(row.id)) log.info({ agentId: row.id }, "no socket — row dropped")
  }

  if (adopted.length > 0 || retained.length > 0) {
    log.info(
      { adopted: adopted.length, retained: retained.length, recovered: recovered.length },
      "adoption complete",
    )
  }
  return { adopted, retained, recovered }
}
