/**
 * ws-to-streams.ts — Browser WebSocket → { ReadableStream, WritableStream }
 *
 * Contract (post-F1 fix — direct in-process pipe, no stdio-to-ws wrapper):
 * 1. Uses native browser WebSocket (not `ws` npm package).
 * 2. Readable: forwards every WS frame as-is to the SDK WITHOUT adding \n.
 *    (SDK buffers partial frames and parses on \n boundary — adding \n to a
 *     partial frame causes "Unterminated string" error and stream teardown.)
 *    No filtering: every byte from the BE pipe is forwarded.
 * 3. Writable: splits chunk on \n, sends each non-empty line with \n suffix
 *    (opencode expects NDJSON newline-delimited stream).
 */

export function wsToWebStreams(ws: WebSocket): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
} {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // ── Readable: incoming WS frames → byte stream (forward as-is) ────────────
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      ws.addEventListener("message", (ev: MessageEvent) => {
        const text =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof ArrayBuffer
              ? decoder.decode(ev.data)
              : String(ev.data)

        // Forward as-is — SDK buffers and parses on \n boundary.
        // DO NOT add \n artificially — a single ACP message may be split across
        // multiple WS frames; adding \n to a partial frame causes the SDK to
        // parse it as a complete message → "Unterminated string" → stream teardown.
        controller.enqueue(encoder.encode(text))
      })

      ws.addEventListener("close", () => {
        try {
          controller.close()
        } catch {
          // already closed
        }
      })

      ws.addEventListener("error", (e) => {
        try {
          controller.error(e)
        } catch {
          // already errored
        }
      })
    },
  })

  // ── Writable: byte stream → outgoing WS frames (one frame per NDJSON line) ─
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = decoder.decode(chunk)
      // SDK writes `{...}\n` lines — split on \n and send each as a separate frame.
      // opencode (via stdio-to-ws) expects NDJSON: each WS frame = one JSON-RPC message + \n.
      for (const line of text.split("\n")) {
        if (line.trim().length > 0) {
          try {
            ws.send(`${line}\n`)
          } catch {
            // ws already closed
          }
        }
      }
    },
    close() {
      try {
        ws.close()
      } catch {
        // already closed
      }
    },
    abort(reason) {
      try {
        ws.close(1011, String(reason))
      } catch {
        // already closed
      }
    },
  })

  return { readable, writable }
}
