/**
 * open-connection.ts — choosing how an agent's process is hosted.
 *
 * Three ways to obtain the same `ProviderConnection`, and the registry should
 * not have to know which is which:
 *
 *   sidecar      — its own process, its own systemd unit, survives our restart
 *   in-process   — an adapter running inside this process (claude, codex)
 *   spawn        — a child process speaking ACP over stdio
 *
 * Extracted from `connection-registry.ts` when the sidecar route was added: the
 * registry's job is the lifecycle of a connection it already has, and mixing the
 * choice of connector into it made a 380-line file grow every time a new way of
 * hosting appeared.
 */

import type { CliKind } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { loadCliSpecsOverride } from "@drive-coding/provider/config"
import type { ConnectOpts, ProviderConnection } from "@drive-coding/provider/connection"
import {
  connectCodexInProcess,
  connectInProcess,
  connectSpawn,
} from "@drive-coding/provider/connection"
import type { SpawnBridgeInput } from "@drive-coding/provider/spawn"
import { connectViaSidecar, sidecarKinds } from "./connect-via-sidecar.js"

const cfgLog = createLogger("backend.acp.config")

/** Adapters hosted inside this process rather than spawned. */
export const IN_PROCESS_CONNECTORS = {
  claude: connectInProcess,
  codex: connectCodexInProcess,
} satisfies Partial<Record<CliKind, (opts: ConnectOpts) => Promise<ProviderConnection>>>

export function overrideHasBinOrArgs(kind: string): boolean {
  const o = loadCliSpecsOverride()[kind]
  return o?.bin !== undefined || o?.args !== undefined
}

export function overrideHasEnv(kind: string): boolean {
  const o = loadCliSpecsOverride()[kind]
  return o?.setEnv !== undefined || o?.unsetEnv !== undefined
}

/**
 * Open a connection to `agentId`'s agent, by whichever route applies.
 *
 * `AGENT_SIDECAR` wins when it names the cliKind: the agent then lives outside
 * this process entirely, and "opening" may mean re-attaching to one that was
 * already running before this backend started.
 */
export async function openProviderConnection(
  agentId: string,
  cliKind: SpawnBridgeInput["cliKind"],
  opts: ConnectOpts,
): Promise<ProviderConnection> {
  if (sidecarKinds().has(cliKind)) {
    return connectViaSidecar(agentId, cliKind, opts)
  }

  const inProcess = IN_PROCESS_CONNECTORS[cliKind as keyof typeof IN_PROCESS_CONNECTORS]
  if (inProcess === undefined) return connectSpawn(cliKind, opts)

  // These two overrides look like they should work for an in-process adapter and
  // do not: the binary is never spawned by us, and the adapter reads this
  // process's env, not one we shape. Warned rather than ignored in silence.
  if (overrideHasBinOrArgs(cliKind)) {
    cfgLog.warn({ cliKind }, "cli-specs override.bin/args ignored for in-process cliKind")
  }
  if (overrideHasEnv(cliKind)) {
    cfgLog.warn(
      { cliKind },
      "cli-specs override env vars are not supported by the in-process bridge",
    )
  }
  return inProcess(opts)
}
