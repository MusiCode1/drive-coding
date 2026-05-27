/**
 * transport.ts — AcpTransport interface.
 *
 * Dependency-inversion seam between the ACP client logic (transport-agnostic)
 * and the underlying byte transport (WebSocket on FE, stdio on BE, mock in tests).
 *
 * Contract:
 *   - `readable`: stream of incoming bytes from the agent (NDJSON frames).
 *     The ACP SDK reads this via `ndJsonStream` which buffers on `\n` boundaries.
 *   - `writable`: stream of outgoing bytes to the agent. The SDK writes
 *     `{...}\n` lines.
 *   - `close()`: caller-initiated termination.
 *   - `onClose(cb)`: subscription to non-caller-initiated termination
 *     (transport disconnect, agent crash, etc.). May fire 0 or 1 times per
 *     transport instance.
 *
 * Both streams are byte streams (`Uint8Array`) to match the SDK contract.
 * Transports that work in text (e.g. browser WebSocket) must convert with
 * `TextEncoder`/`TextDecoder` internally.
 */

export interface AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  close(): void
  onClose(cb: (code: number, reason: string) => void): void
}
