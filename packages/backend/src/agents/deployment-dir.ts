/**
 * deployment-dir.ts — one directory per deployment, holding everything about
 * its agents.
 *
 * ```
 *   $XDG_RUNTIME_DIR/drive-coding/deployments/<name>/
 *       agents.json          the registry snapshot
 *       <agentId>.sock       the sidecar's socket
 *       <agentId>.json       what that sidecar says it is
 * ```
 *
 * ─── 🔴 Why not keyed by port ────────────────────────────────────────────────
 *
 * It was, and that was wrong. The port kept dev/edge/main from adopting — and
 * reaping — each other's agents, which is a real requirement. But it made the
 * *port* the identity of a deployment, and a port is exactly the thing that
 * changes when you move a deployment: bring the same backend up on another port
 * and every one of its running agents is instantly an orphan, because it goes
 * looking in a directory that was never populated.
 *
 * A name does not change when the port does. `DC_DEPLOYMENT=edge` keeps its
 * agents across a port move, a rename of the unit, or a migration from one
 * deployment to another — the case this was blocking.
 *
 * The default is still the port, so an unconfigured backend keeps the isolation
 * that the old layout gave for free. You have to name a deployment to share one.
 *
 * ─── Why the snapshot moved in here too ──────────────────────────────────────
 *
 * It used to live under `<stateDir>` so it would survive a reboot, while the
 * sockets sat in tmpfs so they would not. That split stopped paying once each
 * sidecar began writing its own meta file: identity is recoverable from the
 * directory itself, so a snapshot that outlives the processes it describes buys
 * nothing — after a reboot every agent is gone and every row would be dropped
 * anyway.
 *
 * One directory is also the thing that makes "point two deployments at the same
 * agents" a single explicit act instead of two coordinated overrides.
 *
 * ⚠️ Two backends sharing a directory at the same time is legal but not
 * friendly: both will adopt the same agents, and client-wins means the last one
 * to speak owns the session. It is meant for a handover, with one side stopped.
 */

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { getStateDir } from "../paths.js"

/** Name of this deployment. Defaults to the port, which is what it used to be. */
export function deploymentName(env: NodeJS.ProcessEnv, fallbackPort: number): string {
  const explicit = env.DC_DEPLOYMENT
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim()
  const port = Number(env.PORT ?? fallbackPort)
  return String(Number.isFinite(port) ? port : fallbackPort)
}

/**
 * Absolute path of this deployment's directory.
 *
 * `DC_DEPLOYMENT_DIR` overrides it wholesale — the escape hatch for a handover
 * where the incoming backend has to look somewhere it would never derive.
 */
export function deploymentDir(env: NodeJS.ProcessEnv, fallbackPort: number): string {
  const explicit = env.DC_DEPLOYMENT_DIR
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim()
  const xdg = env.XDG_RUNTIME_DIR
  const base = xdg !== undefined && xdg !== "" ? join(xdg, "drive-coding") : getStateDir()
  return join(base, "deployments", deploymentName(env, fallbackPort))
}

/** Creates it 0700 if missing and returns it. */
export function ensureDeploymentDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** The registry snapshot lives beside the sockets it describes. */
export function snapshotPathIn(dir: string): string {
  return join(dir, "agents.json")
}
