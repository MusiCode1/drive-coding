import { connect } from "node:net"

/**
 * socket-live.ts — is something actually listening on this path right now?
 *
 * `stat` cannot answer it. A Unix socket file outlives the process that bound
 * it and stats perfectly well afterwards (measured), so `existsSync` says yes
 * about a corpse. Only `connect(2)` distinguishes them: ECONNREFUSED is the
 * corpse, a completed connection is a live peer.
 *
 * The probe hangs up immediately and never sends a frame. Because promotion in
 * `listenUnix` is triggered by the first frame rather than by connecting, this
 * is invisible to whoever currently owns the session — it cannot take ownership
 * away by looking.
 *
 * ⚠️ A timeout counts as **live**, not dead. The question this answers is "may I
 * unlink this path", and the cost of guessing wrong is stranding a running agent
 * forever. Refusing to bind is recoverable; unlinking is not.
 */
export function isSocketLive(path: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(path)
    const done = (live: boolean): void => {
      clearTimeout(timer)
      sock.destroy()
      resolve(live)
    }
    const timer = setTimeout(() => done(true), timeoutMs)
    timer.unref?.()
    sock.once("connect", () => done(true))
    sock.once("error", () => done(false))
  })
}
