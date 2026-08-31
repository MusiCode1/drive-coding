import { Readable, Writable } from "node:stream"
import type { AcpTransport } from "./types.js"

/**
 * Stdio byte transport — toWeb on stdin/stdout (defaults to process.*).
 * close() does not kill the process.
 */
export function createStdioTransport(opts?: {
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
}): AcpTransport {
  const stdin = opts?.stdin ?? process.stdin
  const stdout = opts?.stdout ?? process.stdout

  const readable = Readable.toWeb(
    stdin as Readable,
  ) as ReadableStream<Uint8Array>
  const writable = Writable.toWeb(stdout as Writable) as WritableStream<Uint8Array>

  let closeCb: ((code: number, reason: string) => void) | undefined
  let closed = false

  stdin.on?.("end", () => {
    if (!closed) {
      closed = true
      closeCb?.(0, "stdin ended")
    }
  })
  stdin.on?.("close", () => {
    if (!closed) {
      closed = true
      closeCb?.(0, "stdin closed")
    }
  })

  return {
    readable,
    writable,
    close() {
      // Does not kill the process — no-op for stdio byte streams.
    },
    onClose(cb) {
      closeCb = cb
    },
  }
}
