/**
 * Node entry — everything that needs node:*. Never import this from the FE.
 *
 * Counterpart to ./browser.ts; both are siblings of the neutral root barrel.
 *
 * node: dependencies pulled in here:
 *   stdio.ts        → node:stream
 *   unix-socket.ts  → node:fs, node:fs/promises, node:net
 *   node-streams.ts → node:net
 *   server.ts       → node:crypto, node:http
 *
 * ⚠️ createNamedPipeTransport is a stub that throws — not verified on Windows.
 */

export { type HttpListenHandle, listenHttp } from "./streamable-http/server.js"
export { createNamedPipeTransport } from "./transport/named-pipe.js"
export { socketToAcpTransport } from "./transport/node-streams.js"
export { createStdioTransport } from "./transport/stdio.js"
export type { AcpTransport } from "./transport/types.js"
export {
  connectUnix,
  listenUnix,
  type UnixListenHandle,
} from "./transport/unix-socket.js"
