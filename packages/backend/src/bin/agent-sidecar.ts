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

import { spawn } from "node:child_process"
import { listenUnix } from "@drive-coding/acp-wire/node"
import { createLogger, initLogger, parseEnvConfig } from "@drive-coding/core/log"
import { getCliCommand, getCliSpec } from "@drive-coding/provider/config"

initLogger(parseEnvConfig())
const log = createLogger("sidecar")

type Args = {
  agentId: string
  cliKind: string
  cwd: string
  socket: string
  modelOverride: string | null
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
  }
}

export async function runSidecar(args: Args): Promise<void> {
  const cli = getCliCommand(args.cliKind, args.modelOverride)

  // Same env shaping spawn-core applies (cli-spec-env-parity): a spec may need
  // a variable removed as much as added, and a sidecar that skipped this would
  // resolve the CLI differently from the in-process path for the same cliKind.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DRIVE_CODING_AGENT_ID: args.agentId }
  const spec = getCliSpec(args.cliKind, process.env)
  for (const key of spec?.unsetEnv ?? []) delete childEnv[key]
  if (spec?.setEnv) Object.assign(childEnv, spec.setEnv)

  const child = spawn(cli.bin, [...cli.args], {
    cwd: args.cwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  log.info({ agentId: args.agentId, pid: child.pid, bin: cli.bin }, "child spawned")

  // stderr is the CLI's own diagnostics — surfaced in the sidecar's journal, not
  // mixed into the ACP stream where it would corrupt framing.
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (text: string) => log.warn({ text: text.trimEnd() }, "child stderr"))

  const handle = await listenUnix(args.socket)
  const startedAt = new Date().toISOString()
  handle.onPing(() => ({
    agentId: args.agentId,
    cliKind: args.cliKind,
    cwd: args.cwd,
    pid: child.pid ?? null,
    startedAt,
    hasOwner: handle.current() !== undefined,
  }))
  log.info({ socket: args.socket }, "listening")

  // Child → whoever currently owns the socket. No owner ⇒ dropped (see above).
  child.stdout.on("data", (chunk: Buffer) => {
    const peer = handle.current()
    if (peer === undefined) return
    const w = peer.writable.getWriter()
    void w.write(new Uint8Array(chunk)).catch(() => {
      /* the owner went away mid-write; the next connect replaces it */
    })
    w.releaseLock()
  })

  // Owner → child. A replacement peer re-subscribes; the old reader ends with it.
  handle.onAccept((peer) => {
    void (async () => {
      const reader = peer.readable.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value !== undefined) child.stdin.write(value)
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
  child.on("exit", (code, signal) => {
    log.info({ code, signal }, "child exited — shutting down")
    handle.close()
    process.exit(code ?? 0)
  })

  const shutdown = (sig: NodeJS.Signals) => (): void => {
    log.info({ sig }, "signal — closing")
    handle.close()
    child.kill(sig)
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
