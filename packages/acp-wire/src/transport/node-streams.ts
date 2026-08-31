import type { Socket } from "node:net"
import type { AcpTransport } from "./types.js"

/**
 * Convert a node:net Socket to an AcpTransport (bytes only).
 * Pattern: data→enqueue · end/close→readable.close · write in Promise · onClose once.
 */
export function socketToAcpTransport(sock: Socket): AcpTransport {
  let readableController: ReadableStreamDefaultController<Uint8Array> | undefined
  let closeCb: ((code: number, reason: string) => void) | undefined
  let closed = false

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readableController = controller
      sock.on("data", (chunk: Buffer) => {
        try {
          readableController?.enqueue(new Uint8Array(chunk))
        } catch {
          // stream already closed
        }
      })
      sock.on("end", () => {
        try {
          readableController?.close()
        } catch {
          // already closed
        }
      })
      sock.on("error", () => {
        try {
          readableController?.error(new Error("socket error"))
        } catch {
          // already closed
        }
      })
      sock.on("close", () => {
        try {
          readableController?.close()
        } catch {
          // already closed
        }
        if (!closed) {
          closed = true
          closeCb?.(0, "socket closed")
        }
      })
    },
  })

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        sock.write(chunk, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
    close() {
      try {
        sock.end()
      } catch {
        // best-effort
      }
    },
    abort() {
      try {
        sock.destroy()
      } catch {
        // best-effort
      }
    },
  })

  return {
    readable,
    writable,
    close() {
      try {
        sock.destroy()
      } catch {
        // best-effort
      }
    },
    onClose(cb) {
      closeCb = cb
    },
  }
}
