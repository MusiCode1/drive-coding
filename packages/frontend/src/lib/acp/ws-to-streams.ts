/**
 * ws-to-streams.ts — Browser WebSocket → { ReadableStream, WritableStream }
 *
 * Port of packages/backend/src/acp/ws-streams.ts with browser adaptations:
 * 1. Uses native browser WebSocket (not `ws` npm package)
 * 2. Filters stdio-to-ws wrapper frames THROUGHOUT the session (not only handshake)
 *    — stdio-to-ws sends heartbeat every ~30s and other frames at any time
 * 3. Readable: forwards ACP frames as-is WITHOUT adding \n
 *    (SDK buffers partial frames and parses on \n boundary — adding \n to partial
 *     frames causes "Unterminated string" error and stream teardown)
 * 4. Writable: splits chunk on \n, sends each non-empty line with \n suffix
 *    (opencode expects NDJSON newline-delimited stream)
 */

const STDIO_TO_WS_FRAME_TYPES = new Set(["connected", "heartbeat", "disconnected", "error"])

export function wsToWebStreams(ws: WebSocket): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
} {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // ── Readable: incoming WS frames → byte stream ────────────────────────────
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      ws.addEventListener("message", (ev: MessageEvent) => {
        const text =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof ArrayBuffer
              ? decoder.decode(ev.data)
              : String(ev.data)

        // Filter stdio-to-ws wrapper frames throughout entire session.
        // ACP JSON-RPC messages always contain "jsonrpc" — quick early detection.
        if (!text.includes('"jsonrpc"')) {
          try {
            const parsed = JSON.parse(text) as { type?: string; jsonrpc?: string }
            if (parsed.jsonrpc === undefined && parsed.type !== undefined) {
              if (STDIO_TO_WS_FRAME_TYPES.has(parsed.type)) {
                return // swallow stdio-to-ws wrapper frame
              }
              // Unknown non-ACP frame — skip rather than corrupt the stream
              console.warn("[acp] dropped non-ACP frame:", text.slice(0, 200))
              return
            }
          } catch {
            // Not JSON — fall through (could be partial NDJSON line)
          }
        }

        // Forward as-is — SDK buffers and parses on \n boundary.
        // DO NOT add \n artificially — stdio-to-ws may split a single ACP message
        // across multiple WS frames. Adding \n to a partial frame causes the SDK to
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
