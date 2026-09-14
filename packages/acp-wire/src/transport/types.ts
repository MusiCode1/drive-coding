/**
 * AcpTransport — byte-transport contract (bytes only, no session-host coupling).
 *
 * readable: incoming bytes from the peer (NDJSON frames).
 * writable: outgoing bytes to the peer.
 * close(): caller-initiated shutdown.
 * onClose(cb): peer-initiated shutdown (0 or 1 invocation per transport).
 */

export interface AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  close(): void
  onClose(cb: (code: number, reason: string) => void): void
}
