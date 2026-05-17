import type { WebSocket } from "ws"
import { createLogger } from "@drive-coding/core/log"

const wireRx = createLogger("backend.acp.wire").ns("rx")
const wireTx = createLogger("backend.acp.wire").ns("tx")

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

        // Forward bytes as-is. The SDK's ndJsonStream buffers across calls
        // and parses on `\n` boundaries. DO NOT add `\n` artificially —
        // stdio-to-ws may split a single ACP message across multiple WS
        // frames (e.g. when opencode writes a long content stream that
        // exceeds the stdout buffer). Adding `\n` to a partial frame causes
        // the SDK to parse it as a complete message → "Unterminated string"
        // error and the stream tears down mid-conversation.
        //
        // Trust that opencode terminates every complete JSON-RPC message
        // with a `\n` byte; partial frames will be concatenated in the
        // SDK's internal buffer and parsed only when the terminator arrives.
        wireRx.trace(
          { len: text.length, text: text.length > 2000 ? `${text.slice(0, 2000)}…` : text },
          "frame",
        )
        controller.enqueue(encoder.encode(text))
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
            wireTx.trace(
              { len: line.length, text: line.length > 2000 ? `${line.slice(0, 2000)}…` : line },
              "frame",
            )
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
