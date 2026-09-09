/**
 * connect-via-sidecar.ts — the sidecar branch of the connection registry.
 *
 * Kept out of `connection-registry.ts` so the routing decision there stays one
 * expression: everything about launching, waiting and socket paths lives here.
 *
 * ─── Opt-in, and off by default ──────────────────────────────────────────────
 *
 * `AGENT_SIDECAR` is a comma-separated list of cliKinds. Unset or empty means
 * nothing changes — every agent takes the path it takes today. That default is
 * deliberate: this route is new, and the existing one carries live work.
 *
 * A CLI is a candidate if something can speak ACP for it over stdio.
 *
 * `cursor`, `opencode` and `gemini` do it themselves. `claude` does not — but
 * the adapter we already depend on ships a binary as well as a library, so the
 * sidecar spawns that and claude becomes an ordinary stdio CLI. Verified live:
 * a full turn, correct auth under a transient unit's minimal environment, and
 * `session/load` after the client died, transcript included.
 *
 * `claude` and `codex` go further: the sidecar *hosts* their adapter rather than
 * piping to it, which keeps `_drive/getQuota` and `_drive/setThinkingTokens`
 * working — both need direct access to the SDK object. Measured on a live
 * sidecar: in pipe mode they answer `-32601 Method not found`; hosted, they
 * answer a real quota snapshot and `{ok:true}`.
 */

import { configDefault } from "@drive-coding/core/config/specs"
import { createLogger } from "@drive-coding/core/log"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import { connectSidecar } from "@drive-coding/provider/connection"
import type { SpawnBridgeInput } from "@drive-coding/provider/spawn"
import { launchOrAttachAgent } from "../agents/agent-launcher.js"
import { probeAgentSocket } from "../agents/agent-sockets.js"
import { deploymentDir, ensureDeploymentDir } from "../agents/deployment-dir.js"

const log = createLogger("backend.acp.sidecar")

/** cliKinds that can currently be hosted in a sidecar. See the header. */
export const SIDECAR_CAPABLE = new Set(["cursor", "opencode", "gemini", "claude", "codex"])

/** How long to wait for a freshly launched sidecar to bind and answer. */
const READY_TIMEOUT_MS = 30_000
const READY_POLL_MS = 200

/**
 * Which cliKinds should go through a sidecar, from `AGENT_SIDECAR`.
 *
 * Unknown or in-process-only kinds are dropped with a warning rather than
 * silently ignored — a typo here would otherwise look like the feature simply
 * not working.
 */
export function sidecarKinds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.AGENT_SIDECAR
  if (raw === undefined || raw.trim() === "") return new Set()
  const out = new Set<string>()
  for (const part of raw.split(",")) {
    const kind = part.trim()
    if (kind === "") continue
    if (!SIDECAR_CAPABLE.has(kind)) {
      log.warn(
        { kind },
        "AGENT_SIDECAR lists a cliKind that cannot be hosted in a sidecar — ignored",
      )
      continue
    }
    out.add(kind)
  }
  return out
}

/** This deployment's directory — sockets, meta and snapshot all live in it. */
export function socketDirForEnv(env: NodeJS.ProcessEnv = process.env): string {
  return deploymentDir(env, configDefault("port"))
}

/**
 * Launch (or attach to) the agent's sidecar and return a ProviderConnection.
 *
 * Attaching and probing are the same act — `launchOrAttachAgent` answers "is one
 * already running" by asking it, so a backend that restarted finds the agent it
 * left behind without any extra step here.
 */
export async function connectViaSidecar(
  agentId: string,
  cliKind: SpawnBridgeInput["cliKind"],
  opts: ConnectOpts,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderConnection> {
  const socketDir = ensureDeploymentDir(socketDirForEnv(env))
  const launched = await launchOrAttachAgent({
    agentId,
    cliKind,
    cwd: opts.cwd,
    modelOverride: opts.modelOverride ?? null,
    socketDir,
    env,
  })
  if (launched.kind === "failed") {
    throw new Error(`sidecar launch failed for ${agentId}: ${launched.reason}`)
  }

  let sidecarPid: number | null = null
  if (launched.kind === "attached") {
    const pid = launched.probe.state === "alive" ? launched.probe.info?.pid : undefined
    sidecarPid = typeof pid === "number" ? pid : null
  } else {
    // Freshly launched: systemd-run returns as soon as the unit is queued, so
    // the socket does not exist yet. Poll the ping rather than the file — a
    // bound-but-unresponsive sidecar is not ready either.
    const deadline = Date.now() + READY_TIMEOUT_MS
    for (;;) {
      const probe = await probeAgentSocket(launched.socket, 1000)
      if (probe.state === "alive") {
        const pid = probe.info?.pid
        sidecarPid = typeof pid === "number" ? pid : null
        break
      }
      if (Date.now() >= deadline) {
        throw new Error(`sidecar for ${agentId} did not become ready (last state: ${probe.state})`)
      }
      await new Promise((r) => setTimeout(r, READY_POLL_MS))
    }
  }

  log.info({ agentId, cliKind, how: launched.kind, sidecarPid }, "connected via sidecar")
  return connectSidecar({ socketPath: launched.socket, cliKind, sidecarPid })
}
