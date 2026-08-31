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

/**
 * Listen on a Unix domain socket. Resolves with transport on first connection.
 * Second connection is destroyed (no queue). transport.close() closes socket+server+unlink.
 */
export function listenUnix(path: string): Promise<AcpTransport> {
  return new Promise((resolve, reject) => {
    let settled = false

    try {
      unlinkSync(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        reject(err)
        return
      }
    }

    const server = createServer((sock) => {
      if (!settled) {
        settled = true
        resolve(wrapListenTransport(sock, server, path))
        return
      }
      sock.destroy()
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

function wrapListenTransport(
  sock: import("node:net").Socket,
  server: ReturnType<typeof createServer>,
  path: string,
): AcpTransport {
  const base = socketToAcpTransport(sock)
  let closed = false

  return {
    readable: base.readable,
    writable: base.writable,
    close() {
      if (closed) return
      closed = true
      base.close()
      server.close()
      void unlinkQuiet(path)
    },
    onClose(cb) {
      base.onClose(cb)
    },
  }
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
