/**
 * in-process-acp-transport.ts — InProcessAcpTransport (C1).
 *
 * Byte-transport that bridges SessionHost ↔ ProviderConnection via:
 *   - readable: lines from conn.wire.onLine → Uint8Array + "\n" (SDK needs \n delimiters)
 *   - writable: Uint8Array from SDK → line-buffered → conn.wire.write
 *   - onClose: adapter from conn.onCrash (BridgeCrashInfo) → (code?, reason?)
 *
 * Implements AcpTransport from @drive-coding/provider/transport (byte-transport),
 * NOT the facade from core/ports.ts.
 *
 * ─── slice session-host-core C1 (TDD) ───
 */

import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import type { AcpTransport } from "@drive-coding/provider/transport"

// ─── Public API ─────────────────────────────────────────────────────────────

export type InProcessAcpTransportDeps = {
  wire: {
    onLine(cb: (line: string) => void): () => void
    write(line: string): boolean
  }
  onCrash(cb: (info: BridgeCrashInfo) => void): () => void
}

/**
 * createInProcessAcpTransport — factory that builds an AcpTransport (byte-transport)
 * backed by a ProviderConnection's wire + onCrash.
 *
 * The caller passes only the two interfaces needed (wire + onCrash) —
 * dependency injection, not the full ProviderConnection, for testability.
 */
export function createInProcessAcpTransport(deps: InProcessAcpTransportDeps): AcpTransport {
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  // ── readable: onLine → ReadableStream<Uint8Array> ────────────────────────
  // Each onLine callback fires with the line (sans \n). We re-add \n because
  // the ACP SDK's ndJsonStream buffers on \n boundaries.
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

  // ── writable: ReadableStream<Uint8Array> → conn.wire.write (line-buffered) ─
  // SDK writes lines of {"...}\n but chunks are NOT guaranteed to align on
  // \n boundaries. We buffer and flush on each \n.
  let lineBuffer = ""

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      lineBuffer += dec.decode(chunk, { stream: true })
      // flush all complete lines
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
      // flush any remaining partial line (shouldn't happen with well-formed NDJSON)
      if (lineBuffer.length > 0) {
        deps.wire.write(lineBuffer + "\n")
        lineBuffer = ""
      }
    },
    abort() {
      lineBuffer = ""
    },
  })

  // ── close ────────────────────────────────────────────────────────────────
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
  }

  // ── onClose: adapter BridgeCrashInfo → (code: number, reason: string) ───
  // ProviderConnection has onCrash(BridgeCrashInfo), but AcpTransport expects
  // onClose(code: number, reason: string). We adapt:
  //   exitCode → code (fall back to 1 if null + signal present)
  //   signal   → reason (if no exitCode)
  function onClose(cb: (code: number, reason: string) => void): void {
    deps.onCrash((info: BridgeCrashInfo) => {
      const code = info.exitCode !== null ? info.exitCode : info.signal !== null ? 1 : 0
      const reason = info.signal !== null ? String(info.signal) : ""
      cb(code, reason)
    })
  }

  return { readable, writable, close, onClose }
}
