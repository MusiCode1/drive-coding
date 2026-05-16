import type { WebSocket } from "ws"

/**
 * Convert ws.WebSocket → { readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array> }
 *
 * The ACP SDK expects a Stream object (via ndJsonStream) that has:
 *   - readable: ReadableStream<Uint8Array>  — incoming NDJSON bytes
 *   - writable: WritableStream<Uint8Array>  — outgoing NDJSON bytes
 *
 * ws.WebSocket delivers/receives discrete frames. We bridge by:
 *   - readable: each incoming WS frame → enqueue as UTF-8 bytes with newline
 *   - writable: each written chunk of bytes → split on newline → send as WS frames
 */
export function wsToStreams(ws: WebSocket): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
} {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // Readable — incoming WS frames → byte stream
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      // stdio-to-ws sends NON-ACP wrapper frames at any time:
      //   - `{"type":"connected","clientId":"..."}`  — on WS open
      //   - `{"type":"heartbeat"}`                   — periodically (every ~30s)
      // These are stdio-to-ws's own protocol, NOT JSON-RPC. They MUST be
      // filtered out, otherwise the SDK's ndJsonStream parser sees them as
      // ACP messages, fails to dispatch, and the connection is torn down.
      // Filter on EVERY frame (not only first) — heartbeats arrive throughout
      // the session.
      const STDIO_TO_WS_FRAME_TYPES = new Set(["connected", "heartbeat", "disconnected", "error"])

      ws.on("message", (data: Buffer | string) => {
        const text = typeof data === "string" ? data : data.toString("utf8")

        // Quick path: ACP JSON-RPC messages always start with {"jsonrpc":
        // stdio-to-ws wrappers start with {"type": — we can early-detect.
        if (!text.includes('"jsonrpc"')) {
          try {
            const parsed = JSON.parse(text) as { type?: string; jsonrpc?: string }
            if (parsed.jsonrpc === undefined && parsed.type !== undefined) {
              if (STDIO_TO_WS_FRAME_TYPES.has(parsed.type)) {
                return // swallow stdio-to-ws wrapper
              }
              // unknown non-ACP frame — log and skip rather than corrupt the stream
              console.warn("[ws-streams] dropped non-ACP frame:", text.slice(0, 200))
              return
            }
          } catch {
            // not JSON — fall through (could be partial NDJSON line)
          }
        }

        // Ensure NDJSON newline termination
        const line = text.endsWith("\n") ? text : `${text}\n`
        controller.enqueue(encoder.encode(line))
      })
      ws.on("close", () => {
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
      ws.on("error", (err) => {
        try {
          controller.error(err)
        } catch {
          // already errored
        }
      })
    },
  })

  // Writable — byte stream → outgoing WS frames (one frame per NDJSON line)
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = decoder.decode(chunk)
      // stdio-to-ws pipes WS frame → subprocess stdin verbatim. opencode acp
      // expects NDJSON (newline-delimited JSON). The SDK's ndJsonStream
      // writes us `{...}\n` lines — we must preserve the trailing newline.
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
      if (ws.readyState === ws.OPEN) {
        ws.close()
      }
    },
    abort(reason) {
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, String(reason))
      }
    },
  })

  return { readable, writable }
}
