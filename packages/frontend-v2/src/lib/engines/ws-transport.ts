/**
 * ws-transport.ts — Browser WebSocket implementation of AcpTransport.
 *
 * Wraps a `WebSocket` with the streams pipeline (`wsToWebStreams`) and adds
 * NAT keepalive ($/ping every 25s) — a WS-specific concern that doesn't
 * apply to stdio or mock transports.
 *
 * Lifecycle:
 *   new WsAcpTransport(url)
 *     → WS in CONNECTING state, streams already wired
 *   await transport.waitForOpen()
 *     → resolves when WS reaches OPEN (heartbeat starts automatically)
 *     → rejects on "error" event
 *   pass to createAcpClient(transport, onUpdate)
 *
 * close() / WS close-from-other-side → heartbeat stops, onClose listeners fire.
 */

import type { AcpTransport } from "@drive-coding/core/acp/transport"
import { wsToWebStreams } from "./ws-to-streams.js"

const HEARTBEAT_INTERVAL_MS = 25_000

export class WsAcpTransport implements AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>

  readonly #ws: WebSocket
  readonly #closeListeners: Array<(code: number, reason: string) => void> = []
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(url: string, ws?: WebSocket) {
    // The `ws` parameter is for tests — production code passes only the URL.
    this.#ws = ws ?? new WebSocket(url)
    // BE may forward binary `Buffer` frames from child stdout (NDJSON bytes).
    // Without binaryType=arraybuffer, browser delivers them as Blob — harder to
    // decode synchronously in the stream pipeline. arraybuffer keeps the decode
    // path uniform.
    this.#ws.binaryType = "arraybuffer"

    // Start heartbeat as soon as the connection is open. We register the
    // listener unconditionally in the constructor so callers don't have to
    // call waitForOpen() in order to get keepalive behavior.
    this.#ws.addEventListener(
      "open",
      () => {
        this.#startHeartbeat()
      },
      { once: true },
    )

    this.#ws.addEventListener("close", (ev: CloseEvent) => {
      this.#stopHeartbeat()
      for (const cb of this.#closeListeners.slice()) {
        cb(ev.code, ev.reason)
      }
    })

    const streams = wsToWebStreams(this.#ws)
    this.readable = streams.readable
    this.writable = streams.writable
  }

  /**
   * Resolves when the WebSocket reaches OPEN state. Rejects on "error" event.
   * Safe to call multiple times — idempotent when already open.
   *
   * Callers must await this before passing the transport to `createAcpClient`,
   * otherwise the SDK's initial write will fail.
   */
  async waitForOpen(): Promise<void> {
    if (this.#ws.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolve, reject) => {
      this.#ws.addEventListener("open", () => resolve(), { once: true })
      this.#ws.addEventListener("error", () => reject(new Error("WS connect failed")), {
        once: true,
      })
    })
  }

  close(): void {
    this.#stopHeartbeat()
    try {
      this.#ws.close()
    } catch {
      // already closed
    }
  }

  onClose(cb: (code: number, reason: string) => void): void {
    this.#closeListeners.push(cb)
  }

  #startHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) return
    this.#heartbeatTimer = setInterval(() => {
      if (this.#ws.readyState === WebSocket.OPEN) {
        try {
          this.#ws.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/ping" })}\n`)
        } catch {
          // ws transitioning to closed — next interval check will skip
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = undefined
    }
  }
}
