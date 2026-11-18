/**
 * Browser-safe entry — no node:stream / net / http.
 * FE must import from `@drive-coding/acp-wire/browser`, not the root barrel.
 */
export type { AcpTransport } from "./transport/types.js"
export { WsAcpTransport } from "./transport/browser-ws.js"
export { wsToWebStreams } from "./transport/browser-ws-streams.js"
