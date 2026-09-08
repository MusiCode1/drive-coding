/**
 * agent-sockets.ts — the socket directory, and what "alive" means in it.
 *
 * Each sidecar listens on `<dir>/<agentId>.sock`, so the directory *is* the
 * discovery mechanism: `readdir` yields the candidates and no index file has to
 * be kept in sync with reality. An index would be a second source of truth, and
 * a process killed with SIGKILL never gets to delete its own row.
 *
 * ⚠️ The directory answers "who is alive". It does NOT answer "who are they" —
 * cliKind, cwd, acpSessionId and the rest live in the registry snapshot
 * (`agents-store.ts`). Re-attach needs both: a live pipe to an agent you have no
 * metadata for is not something you can put in a UI.
 *
 * ─── 🛑 stat() cannot answer the question ────────────────────────────────────
 *
 * A socket file outlives the process that bound it, and `existsSync`/`statSync`
 * both succeed on the corpse (measured 2026-09-08). The only test is to
 * `connect(2)`: connected ⇒ someone is listening; `ECONNREFUSED` ⇒ the inode is
 * an orphan and may be unlinked. Cleanup is therefore self-healing — whoever
 * discovers the refusal is the one who removes it. No reaper, no daemon.
 *
 * A second level exists above that: a peer wedged in a blocked event loop still
 * completes the handshake, because the kernel accepts into the backlog without
 * the process being involved. `connect()` alone would call it healthy. That is
 * what `_drive/ping` is for — see `probeAgentSocket`.
 *
 * ─── 🛑 Not /tmp ─────────────────────────────────────────────────────────────
 *
 * The obvious home is `/tmp`, on the grounds that a reboot clears it and there
 * are no ghost sockets. True but incomplete: `/tmp` is *also* cleared while the
 * machine runs. Measured 2026-09-08 on srv1812097 —
 * `q /tmp 1777 root root 10d` in `/usr/lib/tmpfiles.d/tmp.conf`, with
 * `systemd-tmpfiles-clean.timer` active and firing daily. A socket's mtime does
 * not advance with traffic, so an agent alive for ten days would have its socket
 * deleted out from under it: existing connections survive (the fd is open) but
 * re-attach after a restart fails — precisely the feature this exists for.
 *
 * `$XDG_RUNTIME_DIR` is tmpfs, 0700, cleared on logout, and has no age policy.
 * `instances.ts` already uses it for the same reason.
 */

import { mkdirSync, readdirSync, unlinkSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"
import { decodePing, decodePong, encodePing, type PingInfo } from "@drive-coding/acp-wire"
import { createLogger } from "@drive-coding/core/log"
import { getStateDir } from "../paths.js"

const log = createLogger("backend.agents.sockets")

const SOCKET_SUFFIX = ".sock"

/**
 * Linux caps `sockaddr_un.sun_path`. Measured on this kernel: 108 bytes bind,
 * 109 fails with EINVAL — and it fails at `listen`, far from the code that
 * chose the name. Our own paths run ~76 bytes, but a deployment that nests the
 * runtime dir deeper would cross it, so the check is explicit and named.
 */
export const MAX_SOCKET_PATH = 108

/** Thrown early, with the length, instead of a bare EINVAL from bind(2). */
export class SocketPathTooLongError extends Error {
  constructor(path: string) {
    super(
      `socket path is ${path.length} bytes, over the ${MAX_SOCKET_PATH}-byte sun_path limit: ${path}`,
    )
    this.name = "SocketPathTooLongError"
  }
}

/**
 * Per-deployment socket directory.
 *
 * Keyed by port for the same reason the registry snapshot is: dev, edge and
 * main share this machine, and a shared directory would have each backend
 * adopting — and reaping — the others' agents.
 */
export function agentSocketDir(port: number, env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_RUNTIME_DIR
  const base = xdg !== undefined && xdg !== "" ? join(xdg, "drive-coding") : getStateDir()
  return join(base, `agents-${port}`)
}

/** Creates the directory 0700 if missing and returns it. */
export function ensureAgentSocketDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function agentSocketPath(dir: string, agentId: string): string {
  const path = join(dir, `${agentId}${SOCKET_SUFFIX}`)
  if (path.length > MAX_SOCKET_PATH) throw new SocketPathTooLongError(path)
  return path
}

/** Agent ids that have a socket file — candidates, not confirmed-live agents. */
export function listAgentSockets(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn({ err, dir }, "socket dir unreadable")
    }
    return []
  }
  return names
    .filter((n) => n.endsWith(SOCKET_SUFFIX))
    .map((n) => n.slice(0, -SOCKET_SUFFIX.length))
}

export type SocketProbe =
  /** Connected, and the peer answered `_drive/ping`. */
  | { state: "alive"; info?: PingInfo }
  /** Connected, but no pong within the budget — bound and not responding. */
  | { state: "wedged" }
  /** ECONNREFUSED — the file is an orphan and was unlinked. */
  | { state: "stale" }
  /** ENOENT, EACCES, or anything else that is not a verdict about the peer. */
  | { state: "unknown"; code?: string }

/**
 * Probe one socket. Never throws.
 *
 * Sends a real `_drive/ping` rather than connecting and hanging up, because a
 * bare connect cannot distinguish a healthy sidecar from one whose event loop is
 * blocked. On `ECONNREFUSED` the orphaned path is unlinked as a side effect —
 * that is the whole of the cleanup story.
 */
export function probeAgentSocket(path: string, timeoutMs = 1000): Promise<SocketProbe> {
  return new Promise((resolve) => {
    const id = `probe-${Date.now()}`
    let done = false
    let buffered = ""

    const sock = connect(path)
    const finish = (result: SocketProbe): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      resolve(result)
    }

    const timer = setTimeout(() => finish({ state: "wedged" }), timeoutMs)
    timer.unref?.()

    sock.on("connect", () => sock.write(encodePing(id)))
    sock.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8")
      let nl = buffered.indexOf("\n")
      while (nl !== -1) {
        const line = buffered.slice(0, nl)
        buffered = buffered.slice(nl + 1)
        const pong = decodePong(line, id)
        if (pong !== null) {
          finish(pong.info === undefined ? { state: "alive" } : { state: "alive", info: pong.info })
          return
        }
        nl = buffered.indexOf("\n")
      }
    })
    sock.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ECONNREFUSED") {
        // The listener is gone; the inode is not. Remove it so the next scan
        // does not have to re-learn the same thing.
        try {
          unlinkSync(path)
        } catch {
          /* someone else got there first — fine */
        }
        finish({ state: "stale" })
        return
      }
      finish(code === undefined ? { state: "unknown" } : { state: "unknown", code })
    })
  })
}

/** Re-export so consumers of this module do not also import acp-wire directly. */
export { decodePing, encodePing }
