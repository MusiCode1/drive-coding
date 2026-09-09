#!/usr/bin/env bun
/**
 * agent-sidecar.ts — hosts one CLI agent behind a Unix socket, outliving the backend.
 *
 * ```
 *   backend ──connect──▶ <dir>/<agentId>.sock ──▶ [ sidecar ] ──stdio──▶ cursor
 * ```
 *
 * Started as its own transient systemd unit (see the launcher), so it is a
 * *sibling* of `drive-coding-edge.service` rather than a child. That placement
 * is the whole point: the unit runs `KillMode=control-group`, which SIGTERMs
 * every process in its cgroup on `systemctl restart` — a sidecar spawned as a
 * normal child would die with the backend no matter how carefully we avoided
 * killing it ourselves.
 *
 * ─── Deliberately a pipe, not an agent host ──────────────────────────────────
 *
 * Decision א of the sidecar design: **zero ACP parsing here.** Bytes from the
 * socket go to the child's stdin, bytes from the child's stdout go to the
 * socket. The one exception is `_drive/ping`, which `listenUnix` answers at the
 * transport boundary and never forwards — so the CLI never sees a method it
 * does not know.
 *
 * Session state, ownership and turn tracking stay in the backend, which already
 * owns them. A sidecar that also held them would be a second source of truth
 * for the same transcript.
 *
 * ⚠️ **Named limitation.** While no backend is attached, output from the child
 * is dropped, not buffered. A turn that produces text in the window between one
 * backend dying and the next connecting loses that text. This is the documented
 * cost of the thin-pipe choice; a ring buffer was deferred until the loss is
 * measured to matter.
 *
 * ─── Scope ───────────────────────────────────────────────────────────────────
 *
 * `cursor` first, and for now only. It already runs through `connectSpawn` —
 * NDJSON over stdio, which is exactly what a pipe relays. `claude` is hosted
 * in-process by a third-party adapter (`connect-in-process.ts`); moving it here
 * is an architecture change, not a port. Both were proven feasible by spike (ז);
 * this is an order, not a verdict.
 */

import { dirname } from "node:path"
import { listenUnix } from "@drive-coding/acp-wire/node"
import { createLogger, initLogger, parseEnvConfig } from "@drive-coding/core/log"
import { removeAgentFiles, writeAgentMeta } from "../agents/agent-sockets.js"
import {
  createBackend,
  defaultModeFor,
  lineSplitter,
  type SidecarMode,
} from "../agents/sidecar-backend.js"

initLogger(parseEnvConfig())
const log = createLogger("sidecar")

type Args = {
  agentId: string
  cliKind: string
  cwd: string
  socket: string
  modelOverride: string | null
  mode: SidecarMode | undefined
}

/** Minimal `--key value` parsing — no dependency, and the caller is our launcher. */
export function parseSidecarArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? undefined : argv[i + 1]
  }
  const required = (name: string): string => {
    const v = get(name)
    if (v === undefined || v === "") throw new Error(`agent-sidecar: missing --${name}`)
    return v
  }
  return {
    agentId: required("agent-id"),
    cliKind: required("cli-kind"),
    cwd: required("cwd"),
    socket: required("socket"),
    modelOverride: get("model") ?? null,
    mode: get("mode") === "pipe" ? "pipe" : get("mode") === "hosted" ? "hosted" : undefined,
  }
}

export async function runSidecar(args: Args): Promise<void> {
  const mode = args.mode ?? defaultModeFor(args.cliKind)
  const backend = await createBackend({
    cliKind: args.cliKind,
    cwd: args.cwd,
    agentId: args.agentId,
    modelOverride: args.modelOverride,
    mode,
  })
  log.info({ agentId: args.agentId, cliKind: args.cliKind, mode }, "backend ready")

  const handle = await listenUnix(args.socket)
  const startedAt = new Date().toISOString()

  // Describe ourselves next to the socket, so the directory can be read without
  // the backend's registry snapshot. A backend that lost our row can rebuild it
  // from here instead of leaving us running and unreachable.
  const socketDir = dirname(args.socket)
  writeAgentMeta(socketDir, {
    agentId: args.agentId,
    cliKind: args.cliKind,
    cwd: args.cwd,
    pid: process.pid,
    startedAt,
  })
  // 🔴 Two pids, and they are not interchangeable. `pid` is this process — the
  // one that owns the socket and matches the systemd unit's MainPID, and the
  // one a caller means when it says "the agent's process". `cliPid` is the CLI
  // underneath, useful for diagnostics and for nothing else: it is our child,
  // so signalling it from outside would bypass the sidecar's own teardown.
  handle.onPing(() => ({
    agentId: args.agentId,
    cliKind: args.cliKind,
    cwd: args.cwd,
    pid: process.pid,
    cliPid: backend.cliPid,
    mode: backend.mode,
    startedAt,
    hasOwner: handle.current() !== undefined,
  }))
  log.info({ socket: args.socket }, "listening")

  // Agent → whoever currently owns the socket. No owner ⇒ dropped (see above).
  backend.onLine((line) => {
    const peer = handle.current()
    if (peer === undefined) return
    const w = peer.writable.getWriter()
    void w.write(new TextEncoder().encode(`${line}\n`)).catch(() => {
      /* the owner went away mid-write; the next connect replaces it */
    })
    w.releaseLock()
  })

  // Owner → child. A replacement peer re-subscribes; the old reader ends with it.
  handle.onAccept((peer) => {
    void (async () => {
      const reader = peer.readable.getReader()
      const decoder = new TextDecoder()
      const inbound = lineSplitter((line) => backend.write(line))
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value !== undefined) inbound(decoder.decode(value, { stream: true }))
        }
      } catch {
        /* peer closed or was replaced — not an error for the child */
      } finally {
        reader.releaseLock()
      }
    })()
  })

  // The sidecar exists to host this child. Without it there is nothing to serve,
  // and a socket that outlived its agent is exactly the ghost the probe hunts.
  backend.onExit((code) => {
    log.info({ code }, "agent ended — shutting down")
    handle.close()
    // Take the description with us: a meta file without a socket would advertise
    // an agent that no longer exists.
    removeAgentFiles(socketDir, args.agentId)
    process.exit(code ?? 0)
  })

  const shutdown = (sig: NodeJS.Signals) => (): void => {
    log.info({ sig }, "signal — closing")
    handle.close()
    removeAgentFiles(socketDir, args.agentId)
    void backend.close()
  }
  process.on("SIGTERM", shutdown("SIGTERM"))
  process.on("SIGINT", shutdown("SIGINT"))
}

// import.meta.main is false when the module is imported by a test.
if (import.meta.main) {
  runSidecar(parseSidecarArgs(process.argv.slice(2))).catch((err: unknown) => {
    log.error({ err }, "sidecar failed to start")
    process.exit(1)
  })
}
