import { createServer, connect } from "node:net"
import { unlinkSync } from "node:fs"
import { unlink } from "node:fs/promises"
import type { AcpTransport } from "./types.js"
import { socketToAcpTransport } from "./node-streams.js"

async function unlinkQuiet(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
}

export type UnixListenHandle = {
  readonly path: string
  readonly transport: AcpTransport
  current(): AcpTransport | undefined
  onAccept(cb: (transport: AcpTransport) => void): void
  close(): void
}

/**
 * Listen on a Unix domain socket. Resolves with handle on first real promotion.
 * Subsequent connections replace the current peer (client-wins). Probe
 * connections (connect+destroy) are ignored. handle.close() tears down server.
 */
export function listenUnix(path: string): Promise<UnixListenHandle> {
  return new Promise((resolve, reject) => {
    let settled = false
    let firstTransport: AcpTransport | undefined
    let currentTransport: AcpTransport | undefined
    const acceptCallbacks: Array<(transport: AcpTransport) => void> = []
    let handleClosed = false

    try {
      unlinkSync(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        reject(err)
        return
      }
    }

    const server = createServer((sock) => {
      const attemptPromote = () => {
        if (handleClosed) {
          sock.destroy()
          return
        }

        if (sock.destroyed || sock.readyState === "closed") {
          return
        }

        const peer = socketToAcpTransport(sock)

        peer.onClose(() => {
          if (currentTransport === peer) {
            currentTransport = undefined
          }
        })

        if (currentTransport) {
          currentTransport.close()
        }

        currentTransport = peer
        if (!firstTransport) {
          firstTransport = peer
        }

        for (const cb of acceptCallbacks) {
          cb(peer)
        }

        if (!settled) {
          settled = true
          resolve({
            path,
            get transport() {
              return firstTransport!
            },
            current() {
              return currentTransport
            },
            onAccept(cb) {
              acceptCallbacks.push(cb)
            },
            close() {
              if (handleClosed) return
              handleClosed = true
              server.close()
              void unlinkQuiet(path)
              currentTransport?.close()
            },
          })
        }
      }

      // Double defer: probe (connect+destroy) closes the server socket before
      // the second tick; real clients stay open through both ticks.
      setImmediate(() => {
        if (handleClosed || sock.destroyed || sock.readyState === "closed") {
          return
        }
        setImmediate(attemptPromote)
      })
    })

    server.on("error", (err) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    })

    server.listen(path)
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
