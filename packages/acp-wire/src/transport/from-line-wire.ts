/**
 * from-line-wire.ts — AcpTransport backed by a line-delimited wire + onCrash.
 *
 * Byte-transport that bridges AcpClient ↔ line wire via:
 *   - readable: lines from wire.onLine → Uint8Array + "\n" (SDK needs \n delimiters)
 *   - writable: Uint8Array from SDK → line-buffered → wire.write
 *   - onClose: adapter from onCrash (LineWireCrashInfo) → (code?, reason?)
 *
 * Implements AcpTransport (byte-transport), NOT the facade from core/ports.ts.
 */

import type { AcpTransport } from "./types.js"

export type LineWire = {
  onLine(cb: (line: string) => void): () => void
  write(line: string): boolean
}

export type LineWireCrashInfo = {
  exitCode: number | null
  signal: string | null
}

export type FromLineWireDeps = {
  wire: LineWire
  onCrash(cb: (info: LineWireCrashInfo) => void): () => void
}

/**
 * createFromLineWire — factory that builds an AcpTransport (byte-transport)
 * backed by a line wire + onCrash.
 *
 * The caller passes only the two interfaces needed (wire + onCrash) —
 * dependency injection, not the full connection, for testability.
 */
export function createFromLineWire(deps: FromLineWireDeps): AcpTransport {
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  let readableController: ReadableStreamDefaultController<Uint8Array> | null = null
  let unsubLine: (() => void) | null = null

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readableController = controller
      unsubLine = deps.wire.onLine((line) => {
        if (readableController) {
          try {
            readableController.enqueue(enc.encode(line + "\n"))
          } catch {
            // controller may be closed — ignore
          }
        }
      })
    },
    cancel() {
      if (unsubLine) {
        unsubLine()
        unsubLine = null
      }
      readableController = null
    },
  })

  let lineBuffer = ""

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      lineBuffer += dec.decode(chunk, { stream: true })
      let nlIndex: number
      while ((nlIndex = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, nlIndex)
        lineBuffer = lineBuffer.slice(nlIndex + 1)
        if (line.length > 0) {
          deps.wire.write(line + "\n")
        }
      }
    },
    close() {
      if (lineBuffer.length > 0) {
        deps.wire.write(lineBuffer + "\n")
        lineBuffer = ""
      }
    },
    abort() {
      lineBuffer = ""
    },
  })

  const crashUnsubs: Array<() => void> = []

  function close(): void {
    if (unsubLine) {
      unsubLine()
      unsubLine = null
    }
    if (readableController) {
      try {
        readableController.close()
      } catch {
        // already closed
      }
      readableController = null
    }
    for (const unsub of crashUnsubs) {
      try {
        unsub()
      } catch {
        // already unsubscribed
      }
    }
    crashUnsubs.length = 0
  }

  function onClose(cb: (code: number, reason: string) => void): void {
    const unsub = deps.onCrash((info: LineWireCrashInfo) => {
      const code = info.exitCode !== null ? info.exitCode : info.signal !== null ? 1 : 0
      const reason = info.signal !== null ? String(info.signal) : ""
      cb(code, reason)
    })
    crashUnsubs.push(unsub)
  }

  return { readable, writable, close, onClose }
}

export { createFromLineWire as createInProcessAcpTransport }
