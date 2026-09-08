/**
 * agent-launcher.ts — start a sidecar *outside* the backend's cgroup, or attach
 * to one that is already running.
 *
 * ─── 🛑 Why systemd-run and not spawn ────────────────────────────────────────
 *
 * ```
 * $ systemctl --user show drive-coding-edge.service -p KillMode
 * KillMode=control-group
 * ```
 *
 * systemd sends SIGTERM to **every process in the unit's cgroup** on restart,
 * not just the main one. `detached: true` at spawn opens a new process *group*,
 * which is a different thing entirely and does not help. A sidecar spawned as an
 * ordinary child of the backend therefore dies with it, no matter how carefully
 * the backend avoids killing it — and it would still pass a naive `kill -9`
 * test, which is what makes this worth stating.
 *
 * A transient unit lands as a *sibling*:
 *
 * ```
 * $ systemd-run --user --unit=dc-probe --collect /bin/sh -c 'sleep 20'
 * ControlGroup=/user.slice/…/app.slice/dc-probe.service     ← not under the backend
 * ```
 *
 * ─── 🛑 …and why every variable is passed explicitly ─────────────────────────
 *
 * A transient user unit does **not** inherit the caller's environment. Measured
 * 2026-09-08: a unit launched from a shell with `DC_PROBE_VAR` set saw 19
 * variables, none of them that one, and a PATH of
 * `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin` — no `~/.bun/bin`, no
 * `~/.local/bin`. So neither `bun` nor the `cursor` binary is reachable by name.
 *
 * That is why the interpreter is an absolute path and why FORWARDED_ENV exists.
 * An allowlist rather than a blanket copy: the sidecar is a long-lived process
 * in a different cgroup, and handing it the whole backend environment would
 * quietly widen what a CLI child can read.
 */

import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createLogger } from "@drive-coding/core/log"
import { agentSocketPath, probeAgentSocket, type SocketProbe } from "./agent-sockets.js"

const log = createLogger("backend.agents.launcher")

/** Unit name for an agent. Stable, so a later `systemctl stop` can find it. */
export function agentUnitName(agentId: string): string {
  return `dc-agent-${agentId}`
}

/**
 * Variables a sidecar genuinely needs. PATH is the one that breaks loudly;
 * the rest break subtly — a missing CLI_SPECS_FILE means the sidecar resolves a
 * different binary than the backend would have.
 */
export const FORWARDED_ENV = [
  "PATH",
  "HOME",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "CLI_SPECS_FILE",
  "CLI_SPECS_JSON",
  "OPENCODE_BIN",
  "OPENCODE_ARGS",
  "LOG_LEVEL",
  "LOG_NS",
  "LOG_FORMAT",
] as const

/** Is there a user service manager to talk to? */
export function hasSystemdUser(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== "linux") return false
  if (env.XDG_RUNTIME_DIR === undefined || env.XDG_RUNTIME_DIR === "") return false
  const probe = spawnSync("systemd-run", ["--version"], { stdio: "ignore" })
  return probe.status === 0
}

/** Absolute path to the sidecar entry, next to this module and same extension. */
export function sidecarEntryPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AGENT_SIDECAR_ENTRY
  if (override !== undefined && override !== "") return override
  const self = fileURLToPath(import.meta.url)
  const ext = self.endsWith(".ts") ? ".ts" : ".js"
  return self.replace(
    /agents[/\\]agent-launcher\.(ts|js)$/,
    `bin${self.includes("\\") ? "\\" : "/"}agent-sidecar${ext}`,
  )
}

export type LaunchOpts = {
  agentId: string
  cliKind: string
  cwd: string
  modelOverride?: string | null
  socketDir: string
  env?: NodeJS.ProcessEnv
}

export type LaunchResult =
  /** A live sidecar was already listening — nothing was started. */
  | { kind: "attached"; socket: string; probe: SocketProbe }
  /** A new sidecar was started. `unit` is null on the non-systemd fallback. */
  | { kind: "launched"; socket: string; unit: string | null }
  | { kind: "failed"; socket: string; reason: string }

function buildSidecarArgv(opts: LaunchOpts, socket: string): string[] {
  const argv = [
    sidecarEntryPath(opts.env),
    "--agent-id",
    opts.agentId,
    "--cli-kind",
    opts.cliKind,
    "--cwd",
    opts.cwd,
    "--socket",
    socket,
  ]
  if (opts.modelOverride != null && opts.modelOverride !== "") {
    argv.push("--model", opts.modelOverride)
  }
  return argv
}

/**
 * Attach to the agent's sidecar, starting one if nothing answers.
 *
 * The probe and the decision are the same act: there is no separate "is it
 * alive" step, because the only reliable answer is whether a `_drive/ping`
 * comes back. A stale socket file is unlinked by the probe on its way out.
 */
export async function launchOrAttachAgent(opts: LaunchOpts): Promise<LaunchResult> {
  const env = opts.env ?? process.env
  const socket = agentSocketPath(opts.socketDir, opts.agentId)

  const probe = await probeAgentSocket(socket)
  if (probe.state === "alive") {
    log.info({ agentId: opts.agentId, socket }, "attaching to running sidecar")
    return { kind: "attached", socket, probe }
  }
  if (probe.state === "wedged") {
    // Bound but not answering. Starting a second sidecar would fail to bind and
    // leave two half-broken things; surfacing it is more useful than guessing.
    return {
      kind: "failed",
      socket,
      reason: "a sidecar is bound to this socket but not responding",
    }
  }

  const argv = buildSidecarArgv(opts, socket)
  // process.execPath is the interpreter running the backend (bun), by absolute
  // path — which the unit's minimal PATH could not have found by name.
  const interpreter = process.execPath

  if (!hasSystemdUser(env)) {
    // Detached so the agent is not in our process group, but this is NOT the
    // real thing: without its own cgroup it still dies with the backend on a
    // systemd restart. Loud on purpose.
    log.warn(
      { agentId: opts.agentId },
      "no systemd user manager — sidecar spawned as a child and will NOT survive a backend restart",
    )
    const child = spawn(interpreter, argv, {
      detached: true,
      stdio: "ignore",
      env: { ...env },
    })
    child.unref()
    return { kind: "launched", socket, unit: null }
  }

  const unit = agentUnitName(opts.agentId)
  const setenv: string[] = []
  for (const key of FORWARDED_ENV) {
    const value = env[key]
    if (value !== undefined) setenv.push(`--setenv=${key}=${value}`)
  }

  const res = spawnSync(
    "systemd-run",
    ["--user", `--unit=${unit}`, "--collect", "--quiet", ...setenv, interpreter, ...argv],
    { encoding: "utf8" },
  )
  if (res.status !== 0) {
    const reason = (res.stderr ?? "").trim() || `systemd-run exited ${res.status}`
    log.warn({ agentId: opts.agentId, reason }, "systemd-run failed")
    return { kind: "failed", socket, reason }
  }
  log.info({ agentId: opts.agentId, unit, socket }, "sidecar launched as transient unit")
  return { kind: "launched", socket, unit }
}

/**
 * End an agent for good — the *kill* half of the disconnect/kill split.
 *
 * Stopping the unit is what actually ends the CLI: closing the socket only
 * detaches, which is the whole point of the design. Safe to call for an agent
 * that was never launched under systemd.
 */
export function stopAgentUnit(agentId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!hasSystemdUser(env)) return false
  const res = spawnSync("systemctl", ["--user", "stop", agentUnitName(agentId)], {
    encoding: "utf8",
    stdio: "ignore",
  })
  return res.status === 0
}
