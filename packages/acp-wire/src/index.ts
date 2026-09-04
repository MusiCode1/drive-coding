/**
 * Root entry — platform-neutral only. Safe to import from FE *and* BE.
 *
 * Nothing here reaches for node:*, directly or transitively, so importing the
 * root barrel can no longer drag node:net/stream into a browser bundle — the
 * failure this package already hit once (fix: "browser entry so FE build does
 * not pull node:stream").
 *
 * Platform-specific entries are siblings, and symmetric:
 *   @drive-coding/acp-wire/browser  — WebSocket + web streams
 *   @drive-coding/acp-wire/node     — stdio · unix socket · net · http server
 *
 * createHttpClient lives here on purpose: it speaks fetch + ReadableStream,
 * so the Streamable HTTP client works in a browser too, not just on the server.
 */

// fetch-based — browser-safe.
export { createHttpClient, type HttpAcpClient } from "./streamable-http/client.js"
// Protocol constants + routing rules — pure data and pure functions.
export {
  ACP_CONNECTION_ID,
  ACP_PATH,
  ACP_SESSION_ID,
  FORBIDDEN_HTTP_PORTS,
} from "./streamable-http/headers.js"
export { inboundKind, outboundSink } from "./streamable-http/routing.js"
// In-memory / line-oriented wire — no platform dependency.
export {
  createFromLineWire,
  createInProcessAcpTransport,
} from "./transport/from-line-wire.js"
export type { AcpTransport } from "./transport/types.js"
