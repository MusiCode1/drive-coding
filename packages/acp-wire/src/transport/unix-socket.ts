import { unlinkSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { connect, createServer, type Socket } from "node:net"
import { decodePing, encodePong, type PingInfo } from "../control/ping.js"
import { socketToAcpTransport } from "./node-streams.js"
import type { AcpTransport } from "./types.js"

/**
 * unix-socket.ts — a listening socket that outlives its clients.
 *
 * ─── Promotion is triggered by data, not by time ─────────────────────────────
 *
 * A sidecar has to tell two kinds of caller apart: the backend, which takes
 * ownership of the ACP session (client-wins — a new backend replaces the old
 * one), and a liveness probe, which must observe without disturbing anything.
 *
 * The previous version guessed from timing: a connection that survived two
 * `setImmediate` ticks was assumed to be a real client, because a
 * connect-then-destroy probe would already be gone. That works for a probe that
 * never speaks, and silently fails for one that does — by the time its frame is
 * read, it has already evicted the live owner.
 *
 * 🔴 The guess existed only because of an assumption that turned out to be
 * false: that a socket can hold one connection. It cannot be forced to — a
 * listening socket is a rendezvous point, and every `accept()` yields an
 * independent connection (measured: five simultaneous, all live). Single-owner
 * was our policy, never the kernel's limit.
 *
 * So the first line decides, and nothing is promoted before it arrives:
 *
 *   `_drive/ping`  → answer, close, promote nothing
 *   anything else  → promote (client-wins), replaying the line just read
 *   closed unread  → promote nothing
 *
 * The last row is what keeps a legacy connect+destroy probe harmless, now as a
 * consequence of the rule rather than as a race that happens to be won.
 *
 * ⚠️ Because of this, `listenUnix` resolves as soon as the socket is bound —
 * it can no longer resolve "on first client", since a client that has not
 * spoken is not yet a peer. Callers that want the old behaviour await
 * `handle.accepted()`.
 */

/** Peek ceiling. A first line longer than this is not a ping; stop buffering. */
const MAX_PEEK_BYTES = 64 * 1024

async function unlinkQuiet(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
}

export type UnixListenHandle = {
  readonly path: string
  /** The peer that currently owns the session, or undefined if none. */
  current(): AcpTransport | undefined
  /** Resolves with the first peer ever promoted. Never rejects. */
  accepted(): Promise<AcpTransport>
  /** Fires on every promotion, including replacements. */
  onAccept(cb: (transport: AcpTransport) => void): void
  /**
   * Supplies the `info` bag attached to a `_drive/ping` answer — identity of
   * whoever is listening (agentId, cliKind, pid …). The transport layer has no
   * business inventing those fields, so it asks.
   */
  onPing(cb: () => PingInfo | undefined): void
  /** Stops listening and unlinks the path. Closing a peer does NOT do this. */
  close(): void
}

/**
 * Listen on a Unix domain socket.
 *
 * Resolves once bound. The returned handle stays valid across peers: a peer
 * disconnecting — or being replaced — never closes the door.
 */
export function listenUnix(path: string): Promise<UnixListenHandle> {
  return new Promise((resolve, reject) => {
    let settled = false
    let currentTransport: AcpTransport | undefined
    let handleClosed = false
    let pingInfo: (() => PingInfo | undefined) | undefined
    const acceptCallbacks: Array<(transport: AcpTransport) => void> = []
    const acceptedWaiters: Array<(transport: AcpTransport) => void> = []
    let firstAccepted: AcpTransport | undefined

    try {
      unlinkSync(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        reject(err)
        return
      }
    }

    function promote(sock: Socket, prelude: readonly Uint8Array[]): void {
      const peer = socketToAcpTransport(sock, prelude)
      peer.onClose(() => {
        if (currentTransport === peer) currentTransport = undefined
      })
      // client-wins: the newcomer owns the session, the incumbent is dropped.
      currentTransport?.close()
      currentTransport = peer
      if (!firstAccepted) {
        firstAccepted = peer
        for (const w of acceptedWaiters) w(peer)
        acceptedWaiters.length = 0
      }
      for (const cb of acceptCallbacks) cb(peer)
    }

    const server = createServer((sock) => {
      if (handleClosed) {
        sock.destroy()
        return
      }

      // Peek phase: buffer until the first newline, then decide once.
      const chunks: Uint8Array[] = []
      let buffered = ""
      let decided = false

      const onData = (chunk: Buffer): void => {
        if (decided) return
        chunks.push(new Uint8Array(chunk))
        buffered += chunk.toString("utf8")

        const nl = buffered.indexOf("\n")
        if (nl === -1) {
          // Never let a peer that sends no newline pin memory open.
          if (buffered.length <= MAX_PEEK_BYTES) return
          decided = true
          sock.off("data", onData)
          promote(sock, chunks)
          return
        }

        decided = true
        sock.off("data", onData)

        const ping = decodePing(buffered.slice(0, nl))
        if (ping !== null) {
          // A probe. Answer and go — the owner never knew it was here.
          sock.end(encodePong(ping.id, pingInfo?.()))
          return
        }
        promote(sock, chunks)
      }

      sock.on("data", onData)
      // A peer that closes without ever completing a line was never a peer.
      sock.on("close", () => {
        decided = true
        sock.off("data", onData)
      })
      sock.on("error", () => {
        decided = true
      })
    })

    server.on("error", (err) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    })

    server.listen(path, () => {
      if (settled) return
      settled = true
      resolve({
        path,
        current() {
          return currentTransport
        },
        accepted() {
          if (firstAccepted) return Promise.resolve(firstAccepted)
          return new Promise<AcpTransport>((res) => acceptedWaiters.push(res))
        },
        onAccept(cb) {
          acceptCallbacks.push(cb)
        },
        onPing(cb) {
          pingInfo = cb
        },
        close() {
          if (handleClosed) return
          handleClosed = true
          server.close()
          void unlinkQuiet(path)
          currentTransport?.close()
        },
      })
    })
  })
}

/**
 * Connect to a Unix domain socket and return an AcpTransport.
 */
export function connectUnix(path: string): Promise<AcpTransport> {
  return new Promise((resolve, reject) => {
    const sock = connect(path)
    sock.once("connect", () => resolve(socketToAcpTransport(sock)))
    sock.once("error", reject)
  })
}
