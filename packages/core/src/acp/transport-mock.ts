/**
 * transport-mock.ts — MockAcpTransport for tests.
 *
 * Provides a fully in-memory `AcpTransport` that lets tests:
 *   1. Emit frames "from the agent" via `emitFrame(json)`.
 *   2. Inspect frames sent "to the agent" via `sentFrames`.
 *   3. Simulate non-caller-initiated close via `simulateClose(code, reason)`.
 *
 * No timers, no network — fully synchronous emission. Tests that need to
 * await downstream effects (the SDK parsing the frame, dispatching to the
 * client handler) typically still need `await Promise.resolve()` or similar
 * microtask flushes.
 *
 * Lives in `core/` (not `tests/`) because it is part of the testing contract:
 * downstream packages (frontend, backend) reuse this same mock to test their
 * own AcpClient consumers.
 */

import type { AcpTransport } from "./transport.js"

export class MockAcpTransport implements AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>

  /**
   * Captured frames written by the SDK to the transport. Each entry is one
   * NDJSON line (without the trailing `\n`). Multi-line writes are split.
   */
  readonly sentFrames: string[] = []

  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined
  #closed = false
  #closeListeners: Array<(code: number, reason: string) => void> = []
  readonly #encoder = new TextEncoder()
  readonly #decoder = new TextDecoder()

  constructor() {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#readableController = controller
      },
    })

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const text = this.#decoder.decode(chunk)
        // SDK writes NDJSON: one JSON object per `\n`-terminated line.
        // Split and store non-empty lines; this matches what a real WS
        // transport would send as separate frames.
        for (const line of text.split("\n")) {
          if (line.trim().length > 0) {
            this.sentFrames.push(line)
          }
        }
      },
    })
  }

  /**
   * Push an NDJSON frame "from the agent" into the readable stream.
   * The trailing `\n` is added automatically (SDK requires it as message
   * boundary — see learnings 2026-05-16).
   *
   * @throws if the transport has already been closed.
   */
  emitFrame(json: string): void {
    if (this.#closed) {
      throw new Error("MockAcpTransport: cannot emit after close")
    }
    if (!this.#readableController) {
      throw new Error("MockAcpTransport: not initialized")
    }
    this.#readableController.enqueue(this.#encoder.encode(`${json}\n`))
  }

  /**
   * Simulate a non-caller-initiated close (transport disconnect, agent crash).
   * Fires the registered `onClose` callbacks and closes the readable stream.
   * Idempotent.
   */
  simulateClose(code = 1000, reason = ""): void {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#readableController?.close()
    } catch {
      // already closed
    }
    for (const cb of this.#closeListeners.slice()) {
      cb(code, reason)
    }
  }

  close(): void {
    this.simulateClose(1000, "client closed")
  }

  onClose(cb: (code: number, reason: string) => void): void {
    this.#closeListeners.push(cb)
  }
}
