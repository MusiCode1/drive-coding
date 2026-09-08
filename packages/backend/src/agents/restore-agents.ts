/**
 * restore-agents.ts — the boot step that brings surviving agents back.
 *
 * Called once, after the dependencies exist and before the server starts
 * serving, so the first request already sees whatever came back rather than an
 * empty list that fills in later.
 *
 * Safe to call when the sidecar route is off: with no socket directory there is
 * nothing to adopt, `restore([])` runs, and the snapshot is trimmed to empty —
 * which is exactly the behaviour of the backend before any of this existed.
 */

import type { CliKind } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { sidecarKinds, socketDirForEnv } from "../acp/connect-via-sidecar.js"
import { adoptLiveAgents } from "./adopt-live-agents.js"
import type { PersistentAgentRegistry } from "./persistent-registry.js"

/** The slice of the connection registry this step needs. */
export type ReattachTarget = {
  connect(agentId: string, cliKind: CliKind, opts: { cwd: string }): Promise<unknown>
}

const log = createLogger("backend.agents.restore")

export type RestoreOpts = {
  registry: PersistentAgentRegistry
  /** Omit to restore rows without re-attaching — valid, but see the note below. */
  connections?: ReattachTarget
  env?: NodeJS.ProcessEnv
  /** Test seam. Production derives this from the port. */
  socketDir?: string
}

export async function restorePersistedAgents(opts: RestoreOpts): Promise<void> {
  const { registry, connections } = opts
  const env = opts.env ?? process.env
  const rows = registry.pendingRows()
  if (rows.length === 0) {
    await registry.restore([])
    return
  }
  if (sidecarKinds(env).size === 0) {
    // Nothing can have survived: every agent was a child of the process that
    // just died. Saying so beats probing a directory that will not exist.
    log.info({ found: rows.length }, "sidecar route off — persisted agents not restored")
    await registry.restore([])
    return
  }
  const adopted = await adoptLiveAgents(rows, opts.socketDir ?? socketDirForEnv(env))
  await registry.restore(adopted)

  // 🔴 Restoring the row is not enough. Everything that serves an agent looks it
  // up in the connection registry first, so a row without a connection is an
  // entry in the list that errors the moment anyone opens it. Measured: with
  // only the row restored, GET /api/agents/:id/state answered
  // "Agent connection not found".
  //
  // ⚠️ Connection level only. No session host is created here: acpSessionIdCache
  // died with the previous process, and a host built without a session id would
  // take the cold branch and call session/new on an agent that may be mid-turn,
  // opening a second session on it. Re-establishing the ACP session is the next
  // slice; this one gets the pipe back.
  if (connections === undefined) return
  for (const agent of adopted) {
    try {
      await connections.connect(agent.id, agent.cliKind as CliKind, { cwd: agent.cwd })
      log.info({ agentId: agent.id }, "reattached connection")
    } catch (err) {
      log.warn({ err, agentId: agent.id }, "reattach failed — row kept, connection missing")
    }
  }
}
