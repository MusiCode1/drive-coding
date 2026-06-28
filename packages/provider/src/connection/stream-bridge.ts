/**
 * stream-bridge.ts — Stream↔wire adapter for connectInProcess (CUT-3b-iii-1).
 *
 * The ACP SDK Stream (sdk@1.0.0) is:
 *   { writable: WritableStream<AnyMessage>, readable: ReadableStream<AnyMessage> }
 * i.e. Web Streams of decoded AnyMessage OBJECTS — not NDJSON strings.
 *
 * ProviderConnection.wire is string-based:
 *   { onLine(cb: (line: string) => void): () => void; write(line: string): boolean }
 *
 * This adapter bridges the two:
 *   wire.write(line)  → JSON.parse(line) as AnyMessage → push to agentEnd.writable
 *   agentEnd.readable → JSON.stringify(msg)             → wire onLine callbacks
 *
 * Naming:
 *   agentEnd  — the Stream that agentApp.connect(agentEnd) receives
 *   wireEnd   — the string-based { onLine, write } that ProviderConnection.wire exposes
 */

import type { AnyMessage, Stream } from "acp-sdk-v1"

export interface WireEnd {
  /** Subscribe to lines emitted from the agent (agent→FE direction). Returns unsubscribe. */
  onLine(cb: (line: string) => void): () => void
  /** Write a line from the FE into the agent (FE→agent direction). Returns false if closed. */
  write(line: string): boolean
}

export interface StreamBridge {
  /** The Stream to pass to agentApp.connect(agentEnd). */
  readonly agentEnd: Stream
  /** The wire-like interface to expose as ProviderConnection.wire. */
  readonly wireEnd: WireEnd
  /** Close both sides of the bridge (signals end of stream). */
  close(): void
}

/**
 * createStreamBridge — builds a bidirectional Stream↔wire adapter.
 *
 * Internally uses two TransformStream<AnyMessage, AnyMessage> channels:
 *   inbound  (FE→agent):  wireEnd.write(line) → JSON.parse → inbound.writable → agentEnd.readable
 *   outbound (agent→FE):  agentEnd.writable → outbound.readable → JSON.stringify → onLine callbacks
 *
 * We use TransformStream as a simple pass-through queue (no transform, just pipe).
 * This avoids any dependency on Node streams and works with native Web Streams API.
 */
export function createStreamBridge(): StreamBridge {
  // Inbound channel: wireEnd.write → agentEnd.readable
  // agentApp reads from agentEnd.readable (it receives messages sent by the FE)
  const inbound = new TransformStream<AnyMessage, AnyMessage>()

  // Outbound channel: agentEnd.writable ← agentApp writes its output messages
  // wireEnd.onLine subscribers receive these as JSON strings
  const outbound = new TransformStream<AnyMessage, AnyMessage>()

  // agentEnd: what agentApp.connect() receives
  // - agentApp READS from agentEnd.readable (our inbound.readable)
  // - agentApp WRITES to agentEnd.writable (our outbound.writable)
  const agentEnd: Stream = {
    readable: inbound.readable,
    writable: outbound.writable,
  }

  // Line subscribers for outbound direction (agent→FE)
  const lineListeners = new Set<(line: string) => void>()
  let closed = false
  let inboundWriter: WritableStreamDefaultWriter<AnyMessage> | null = null

  // Start draining the outbound channel (agent→FE) and broadcasting to listeners.
  // We do this lazily in a microtask so agentApp.connect() can be called first.
  let drainStarted = false

  function ensureDraining(): void {
    if (drainStarted) return
    drainStarted = true
    void drainOutbound()
  }

  async function drainOutbound(): Promise<void> {
    const reader = outbound.readable.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (closed) break
        const line = JSON.stringify(value)
        for (const cb of lineListeners) {
          try {
            cb(line)
          } catch {
            /* listeners must not break the pipe */
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  const wireEnd: WireEnd = {
    onLine(cb: (line: string) => void): () => void {
      ensureDraining()
      lineListeners.add(cb)
      return () => {
        lineListeners.delete(cb)
      }
    },

    write(line: string): boolean {
      if (closed) return false
      if (!inboundWriter) {
        inboundWriter = inbound.writable.getWriter()
      }
      let msg: AnyMessage
      try {
        msg = JSON.parse(line) as AnyMessage
      } catch {
        // Malformed JSON — drop and return false (matches spawn-core behavior on parse errors)
        return false
      }
      // Write is async but we return synchronously (fire-and-forget, matching wire contract).
      // Backpressure is handled by the WritableStream internally.
      void inboundWriter.write(msg)
      return true
    },
  }

  return {
    agentEnd,
    wireEnd,

    close(): void {
      if (closed) return
      closed = true
      // Close the inbound writer (signals no more input to agentApp)
      if (inboundWriter) {
        void inboundWriter.close().catch(() => {
          /* ignore close errors */
        })
      } else {
        // Writer was never acquired — close the stream directly
        const w = inbound.writable.getWriter()
        void w.close().catch(() => {
          /* ignore */
        })
      }
      // Close outbound.writable to signal end to the reader drain loop
      // Note: agentApp controls outbound.writable; we only close outbound.readable
      // indirectly by letting the drain loop finish. The drain loop will stop when
      // the stream closes (agentApp closes agentEnd.writable = outbound.writable).
    },
  }
}
